import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"

function hostname(stage: string) {
  if (stage === "prod") return "openfacts.app"

  if (/^pr-[1-9]\d*$/.test(stage)) return `preview.${stage.slice(3)}.openfacts.app`

  return undefined
}

// Whether the stage reads production's catalog (its D1 tables and vector
// index) and stored series instead of its own. A pull request's preview and
// `alchemy dev` do, so they answer searches and draw stored charts on their
// first request with no build of their own; local Workflows run no
// schedules, so a local catalog would stay empty. A pull request that
// changes what they hold or how they are built carries the own-catalog
// label, and CI sets OWN_CATALOG from it; OWN_CATALOG=true does the same for
// `alchemy dev`. Production, and a stage someone deploys by hand, keep their
// own. The Worker never reads the stage: it gets bindings, and Workflows
// only when it owns them.
const sharesCatalog = Effect.fn(function* (stage: string) {
  const own = yield* Config.Boolean("OWN_CATALOG").pipe(Config.withDefault(false))
  const context = yield* Effect.serviceOption(Alchemy.AlchemyContext)

  return !own && (stage.startsWith("pr-") || Option.exists(context, ({ dev }) => dev))
})

export default Alchemy.Stack(
  "civicdata",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack

    const domain = hostname(stage)

    const verification = yield* Option.match(Option.fromUndefinedOr(domain), {
      onNone: () => Effect.succeedNone,
      onSome: () =>
        Effect.gen(function* () {
          return Option.some({
            sitekey: yield* Config.String("TURNSTILE_SITE_KEY"),
            secret: yield* Config.Redacted("TURNSTILE_SECRET_KEY"),
          })
        }),
    })

    const shared = yield* sharesCatalog(stage)

    // The stage's own database, for what requests write. Never production's
    // in a preview. Threads and saved Views are the only data that cannot be
    // rebuilt, so a production destroy keeps the database.
    const database = yield* Cloudflare.D1.Database("Database").pipe(
      Alchemy.RemovalPolicy.retain(stage === "prod"),
    )

    // R2 refuses to delete a bucket that holds objects. Outside production
    // every bucket holds only what can be fetched or published again, so
    // destroying any other stage empties them first; production keeps the
    // refusal. A destroy reads this from the stage's last deploy, not from
    // this file.
    const forceDestroy = stage !== "prod"

    // Series cache. Every object can be fetched again from its source.
    const cache = yield* Cloudflare.R2.Bucket("Cache", { forceDestroy })

    // The Workflows' account-wide names, one per stage. CI reads the
    // catalog's from the stack output to start a build after each deploy of
    // a stage that owns its catalog; a shared stage outputs none.
    const prefix = `civicdata-${stage.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-")}`
    const catalog = `${prefix}-catalog`

    // Only production runs its Workflows on a schedule. Every stage paces
    // its own requests (packages/server/src/Pace.ts), so each scheduled
    // stage adds a full stage's traffic against the publishers. Another
    // stage with its own catalog builds once after each deploy, which CI
    // starts, and gathers only when someone starts a run
    // (.github/workflows/gather.yml). An empty list clears the schedules an
    // earlier deploy set.
    const scheduled = stage === "prod"

    // The catalog, the political records, the directions and the series'
    // bookkeeping (CATALOG_DB), the stored series, the vector index, the
    // paper store and the Workflows that build them: the stage's own, or
    // production's, which a shared stage reads and never builds.
    const owned = Effect.gen(function* () {
      return {
        catalogDatabase: database,
        // Every stored series, one object each, which the gathering Workflow
        // fills and charts read. A bucket of its own: unlike the cache it
        // never expires, and its size and writes are the store's alone.
        series: yield* Cloudflare.R2.Bucket("Series", { forceDestroy }),
        // Indicator meaning for catalog search, embedded with the model in
        // packages/server/src/Vectors.ts. Each catalog build fills it again.
        vectors: yield* Cloudflare.Vectorize.Index("Vectors", {
          preset: "@cf/baai/bge-small-en-v1.5",
        }),
        // The paper store (docs/papers.md): bibliography, copies, versions,
        // passages and annotations in a database of its own, so passage
        // search never queues behind catalog searches, and each version's
        // PDF and text in a bucket. Annotations cost model calls to redo, so
        // a production destroy keeps the database.
        papersDatabase: yield* Cloudflare.D1.Database("PapersDatabase").pipe(
          Alchemy.RemovalPolicy.retain(stage === "prod"),
        ),
        papers: yield* Cloudflare.R2.Bucket("Papers", { forceDestroy }),
        // The Workflows that build the catalog, gather the series and
        // annotate papers. A stage with its own catalog needs them even
        // unscheduled: only a Workflow writes its tables and buckets, and a
        // build refuses to run in a Worker that binds the catalog's or the
        // gather's alone (`database` in packages/server/src/CatalogBuild.ts).
        workflows: Option.some({
          // Builds the indicator catalog, in production every Monday at
          // 04:00 UTC: a native Workflow schedule, no Cron Trigger. CI starts
          // one more build after each deploy, since a new stage has no
          // catalog until then.
          CATALOG: Cloudflare.Workflow("Catalog", {
            workflowName: catalog,
            className: "CatalogWorkflow",
            schedules: scheduled ? ["0 4 * * 1"] : [],
          }),
          // Gathers each source's series into SERIES, in production every day
          // at 05:00 UTC, after Monday's catalog build. Deploys start no run;
          // the Gather series GitHub workflow (.github/workflows/gather.yml)
          // starts one on demand, by this name.
          GATHER: Cloudflare.Workflow("Gather", {
            workflowName: `${prefix}-gather`,
            className: "GatherWorkflow",
            schedules: scheduled ? ["0 5 * * *"] : [],
          }),
          // Annotates stored paper versions with the model
          // (docs/papers.md#annotation), in production every day at 06:00
          // UTC, after the gather: each run annotates the versions questions
          // asked for, up to its caps. Elsewhere only when someone starts a
          // run (.github/workflows/annotate.yml): each run costs model calls.
          ANNOTATE: Cloudflare.Workflow("Annotate", {
            workflowName: `${prefix}-annotate`,
            className: "AnnotateWorkflow",
            schedules: scheduled ? ["0 6 * * *"] : [],
          }),
        }),
      }
    })

    // A ref names another stage's resource without declaring it here, so the
    // resource never enters this stage's state: a deploy only reads its id,
    // and a destroy, which deletes what the stage's state holds, never
    // reaches it (docs/deploys.md). Requests only read what the refs bind;
    // only the Workflows write, and a shared stage has none.
    const production = Effect.gen(function* () {
      const prod = { stage: "prod" }

      return {
        catalogDatabase: yield* Cloudflare.D1.Database.ref("Database", prod),
        series: yield* Cloudflare.R2.Bucket.ref("Series", prod),
        vectors: yield* Cloudflare.Vectorize.Index.ref("Vectors", prod),
        papersDatabase: yield* Cloudflare.D1.Database.ref("PapersDatabase", prod),
        papers: yield* Cloudflare.R2.Bucket.ref("Papers", prod),
        // None: their schedules would rebuild production's catalog and store
        // with the pull request's code, and an annotation run would write
        // production's papers.
        workflows: Option.none(),
      }
    })

    const { catalogDatabase, series, vectors, papersDatabase, papers, workflows } = yield* shared
      ? production
      : owned

    // The agent's OpenAI key and model, from the shell, CI, the Keychain
    // through `with-key.sh`, or `.env` next to this file (see `.env.example`).
    // A stage deployed without a key still works; asking a question answers
    // "unavailable". GitHub passes a missing secret as an empty string, so
    // empty means unset.
    const openAiKey = Option.filter(
      yield* Config.option(Config.Redacted("OPENAI_API_KEY")),
      (key) => Redacted.value(key) !== "",
    )

    const openAiModel = Option.filter(
      yield* Config.option(Config.String("OPENAI_MODEL")),
      (model) => model !== "",
    )

    // Where the stage sends its spans (docs/traces.md): Grafana Cloud's OTLP
    // endpoint and its Authorization header, or the local Grafana `pnpm dev` starts.
    // Without an endpoint the stage records none.
    const otlpEndpoint = Option.filter(
      yield* Config.option(Config.String("OTEL_EXPORTER_OTLP_ENDPOINT")),
      (endpoint) => endpoint !== "",
    )

    const otlpHeaders = Option.filter(
      yield* Config.option(Config.Redacted("OTEL_EXPORTER_OTLP_HEADERS")),
      (headers) => Redacted.value(headers) !== "",
    )

    // The commit deployed, which GitHub Actions sets. Each span carries it.
    const version = Option.filter(
      yield* Config.option(Config.String("GITHUB_SHA")),
      (sha) => sha !== "",
    )

    const web = yield* Cloudflare.Website.Vite("Web", {
      rootDir: "../../apps/web",
      ...Option.match(Option.fromUndefinedOr(domain), {
        onNone: () => ({}),
        onSome: (name) => ({ domain: { name, zoneName: "openfacts.app" } }),
      }),
      // Pinned so an Alchemy upgrade can't change the runtime. Keep in sync
      // with packages/server/vitest.config.ts.
      compatibility: { date: "2026-08-31" },
      // Workflows run many steps in one invocation, whose CPU adds up: a
      // World Bank gathering run spends about 30 seconds and tripped the
      // 30-second default. Five minutes is the most Workers Paid allows. The
      // limit is the Worker's, so visitors' requests get it too.
      limits: { cpuMs: 300_000 },
      env: {
        DB: database,
        CATALOG_DB: catalogDatabase,
        CACHE: cache,
        SERIES: series,
        VECTORS: vectors,
        PAPERS_DB: papersDatabase,
        PAPERS: papers,
        AI: Cloudflare.Workers.AI(),
        // One Durable Object per conversation, exported by apps/web/src/server.ts.
        CONVERSATION: Cloudflare.DurableObject("Conversation", {
          className: "ConversationObject",
        }),
        // One Durable Object per source, pacing requests to it.
        PACE: Cloudflare.DurableObject("Pace", { className: "PaceObject" }),
        ...Option.match(workflows, { onNone: () => ({}), onSome: (bound) => bound }),
        // Every question costs model calls: five per visitor per minute.
        ASK_LIMIT: Cloudflare.RateLimit("AskLimit", {
          namespaceId: 1001,
          simple: { limit: 5, period: 60 },
        }),
        ...Option.match(openAiKey, {
          onNone: () => ({}),
          onSome: (key) => ({ OPENAI_API_KEY: key }),
        }),
        // Only production classifies catalog directions with OpenAI. A
        // preview with its own catalog would pay a full pass on its first
        // build, so its maps colour the hand-checked indicators only; a
        // shared preview reads production's directions.
        CLASSIFY_DIRECTIONS: stage === "prod" ? "on" : "off",
        ...Option.match(openAiModel, {
          onNone: () => ({}),
          onSome: (model) => ({ OPENAI_MODEL: model }),
        }),
        // Each visitor's browser sends a batch of spans at most every five
        // seconds, and one more when the page hides.
        TRACE_LIMIT: Cloudflare.RateLimit("TraceLimit", {
          namespaceId: 1002,
          simple: { limit: 30, period: 60 },
        }),
        STAGE: stage,
        ...Option.match(verification, {
          onNone: () => ({}),
          onSome: ({ sitekey, secret }) => ({
            VITE_TURNSTILE_SITE_KEY: sitekey,
            TURNSTILE_SECRET_KEY: secret,
          }),
        }),
        ...Option.match(version, {
          onNone: () => ({}),
          onSome: (sha) => ({ VERSION: sha }),
        }),
        ...Option.match(otlpEndpoint, {
          onNone: () => ({}),
          onSome: (endpoint) => ({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }),
        }),
        ...Option.match(otlpHeaders, {
          onNone: () => ({}),
          onSome: (headers) => ({ OTEL_EXPORTER_OTLP_HEADERS: headers }),
        }),
      },
    })

    return {
      url: web.url,
      ...Option.match(workflows, { onNone: () => ({}), onSome: () => ({ catalog }) }),
    }
  }),
)
