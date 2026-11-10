import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"

export default Alchemy.Stack(
  "civicdata",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack

    // Threads and saved Views are the only data that cannot be rebuilt, so a
    // production destroy keeps the database.
    const database = yield* Cloudflare.D1.Database("Database").pipe(
      Alchemy.RemovalPolicy.retain(stage === "prod"),
    )

    // Series cache. Every object can be fetched again from its source.
    const cache = yield* Cloudflare.R2.Bucket("Cache")

    // Every stored series, one object each, which the gathering Workflow
    // fills and charts read. A bucket of its own: unlike the cache it never
    // expires, and its size and writes are the store's alone.
    const series = yield* Cloudflare.R2.Bucket("Series")

    // Indicator meaning for catalog search, embedded with the model in
    // packages/server/src/Vectors.ts. Each catalog build fills it again.
    const vectors = yield* Cloudflare.Vectorize.Index("Vectors", {
      preset: "@cf/baai/bge-small-en-v1.5",
    })

    // The agent's OpenAI key and model, from the shell, CI, or `.env` next to
    // this file (see `.env.example`). A stage deployed without a key still
    // works; asking a question answers "unavailable". GitHub passes a missing
    // secret as an empty string, so empty means unset.
    const openAiKey = Option.filter(
      yield* Config.option(Config.Redacted("OPENAI_API_KEY")),
      (key) => Redacted.value(key) !== "",
    )

    const openAiModel = Option.filter(
      yield* Config.option(Config.String("OPENAI_MODEL")),
      (model) => model !== "",
    )

    // The Workflows' account-wide names, one per stage. CI reads the
    // catalog's from the stack output to start a build after each deploy.
    const prefix = `civicdata-${stage.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-")}`
    const catalog = `${prefix}-catalog`

    const web = yield* Cloudflare.Website.Vite("Web", {
      rootDir: "../../apps/web",
      // Pinned so an Alchemy upgrade can't change the runtime. Keep in sync
      // with packages/server/vitest.config.ts.
      compatibility: { date: "2026-08-31" },
      // Workflows run many steps in one invocation, whose CPU adds up: a
      // World Bank gathering run spends about 30 seconds and tripped the
      // 30-second default. Five minutes is the most Workers Paid allows.
      // A gathering run's R2 reads and writes count as subrequests of its
      // Workflow instance, and storing Eurostat's datasets takes millions,
      // past the default of 10,000; ten million is the most allowed. Both
      // limits are the Worker's, so visitors' requests get them too.
      limits: { cpuMs: 300_000, subrequests: 10_000_000 },
      env: {
        DB: database,
        CACHE: cache,
        SERIES: series,
        VECTORS: vectors,
        AI: Cloudflare.Workers.AI(),
        // One Durable Object per conversation, exported by apps/web/src/server.ts.
        CONVERSATION: Cloudflare.DurableObject("Conversation", {
          className: "ConversationObject",
        }),
        // One Durable Object per source, pacing requests to it.
        PACE: Cloudflare.DurableObject("Pace", { className: "PaceObject" }),
        // Builds the indicator catalog every Monday at 04:00 UTC: a native
        // Workflow schedule, no Cron Trigger. CI starts one more build after
        // each deploy, since a new stage has no catalog until then.
        CATALOG: Cloudflare.Workflow("Catalog", {
          workflowName: catalog,
          className: "CatalogWorkflow",
          schedules: ["0 4 * * 1"],
        }),
        // Gathers each source's series into SERIES every day at 05:00 UTC,
        // after Monday's catalog build. Deploys start no run; the Gather
        // series GitHub workflow (.github/workflows/gather.yml) starts one
        // on demand, by this name.
        GATHER: Cloudflare.Workflow("Gather", {
          workflowName: `${prefix}-gather`,
          className: "GatherWorkflow",
          schedules: ["0 5 * * *"],
        }),
        // Every question costs model calls: five per visitor per minute.
        ASK_LIMIT: Cloudflare.RateLimit("AskLimit", {
          namespaceId: 1001,
          simple: { limit: 5, period: 60 },
        }),
        ...Option.match(openAiKey, {
          onNone: () => ({}),
          onSome: (key) => ({ OPENAI_API_KEY: key }),
        }),
        ...Option.match(openAiModel, {
          onNone: () => ({}),
          onSome: (model) => ({ OPENAI_MODEL: model }),
        }),
      },
    })

    return { url: web.url, catalog }
  }),
)
