// Manual operation. Supply explicit D1 and R2 targets only after owner approval.
import { Config, Duration, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"

import { Step } from "../src/CatalogBuild.ts"
import { Gather } from "../src/Gather.ts"
import { Ilostat } from "../src/Ilostat.ts"
import { Insee } from "../src/Insee.ts"
import { Pace } from "../src/Pace.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { Store } from "../src/Store.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { d1 } from "./d1.ts"
import { archiveLayer } from "./ilostat-archive.ts"
import { storage } from "./ilostat-storage.ts"

const program = Effect.gen(function* () {
  const account = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
  const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN")
  const database = yield* Config.String("ILOSTAT_D1_ID")
  const bucket = yield* Config.String("ILOSTAT_R2_BUCKET")

  const bucketTransport = yield* storage({ account, token, bucket })

  const gather = Gather.layer.pipe(
    Layer.provide(Sources.layer),
    Layer.provide(Insee.layer),
    Layer.provide(WorldBank.layer),
    Layer.provide(Sdmx.layer),
    Layer.provide(Store.r2(bucketTransport)),
    Layer.provide(d1({ account, database, token }).layer),
  )

  yield* Gather.run("ILOSTAT").pipe(Effect.provide(Layer.merge(gather, Step.immediate)))
}).pipe(Effect.provide(Ilostat.layer.pipe(Layer.provide(archiveLayer))))

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      Pace.paced(Duration.seconds(10)).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(Pace.memory),
      ),
    ),
  ),
)
