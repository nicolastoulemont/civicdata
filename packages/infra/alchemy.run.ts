import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"

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

    const web = yield* Cloudflare.Website.Vite("Web", {
      rootDir: "../../apps/web",
      // Pinned so an Alchemy upgrade can't change the runtime. Keep in sync
      // with packages/server/vitest.config.ts.
      compatibility: { date: "2026-08-31" },
      env: { DB: database, CACHE: cache },
    })

    return { url: web.url }
  }),
)
