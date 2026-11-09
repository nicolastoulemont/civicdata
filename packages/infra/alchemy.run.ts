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

    // Indicator meaning for catalog search, embedded with the model in
    // packages/server/src/Vectors.ts. Searches fill it again from the catalog.
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

    const web = yield* Cloudflare.Website.Vite("Web", {
      rootDir: "../../apps/web",
      // Pinned so an Alchemy upgrade can't change the runtime. Keep in sync
      // with packages/server/vitest.config.ts.
      compatibility: { date: "2026-08-31" },
      env: {
        DB: database,
        CACHE: cache,
        VECTORS: vectors,
        AI: Cloudflare.Workers.AI(),
        // One Durable Object per conversation, exported by apps/web/src/server.ts.
        CONVERSATION: Cloudflare.DurableObject("Conversation", {
          className: "ConversationObject",
        }),
        // One Durable Object per source, pacing requests to it.
        PACE: Cloudflare.DurableObject("Pace", { className: "PaceObject" }),
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

    return { url: web.url }
  }),
)
