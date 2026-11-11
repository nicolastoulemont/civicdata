// Manual operation. Supply explicit D1 and R2 targets only after owner approval.
import { Config, Duration, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"

import { Step } from "../src/CatalogBuild.ts"
import { Faostat } from "../src/Faostat.ts"
import { Gather } from "../src/Gather.ts"
import { Ilostat } from "../src/Ilostat.ts"
import { Imf } from "../src/Imf.ts"
import { Insee } from "../src/Insee.ts"
import { Pace } from "../src/Pace.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { Store } from "../src/Store.ts"
import { Vdem } from "../src/Vdem.ts"
import { Who } from "../src/Who.ts"
import { Wid } from "../src/Wid.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { d1 } from "./d1.ts"
import { faoArchive } from "./faostat-archive.ts"
import { archiveLayer as iloArchive } from "./ilostat-archive.ts"
import { storage } from "./ilostat-storage.ts"
import { imfArchive } from "./imf-archive.ts"
import { vdemArchive } from "./vdem-archive.ts"
import { widArchive } from "./wid-archive.ts"

const archives = (source: "FAOSTAT" | "ILOSTAT" | "V-Dem" | "WID" | "IMF") =>
  Layer.merge(
    Layer.merge(
      source === "V-Dem" ? Vdem.layer.pipe(Layer.provide(vdemArchive)) : Vdem.layer,
      source === "IMF" ? Imf.layer.pipe(Layer.provide(imfArchive)) : Imf.layer,
    ),
    source === "WID" ? Wid.layer.pipe(Layer.provide(widArchive)) : Wid.layer,
  )

export const fill = (source: "FAOSTAT" | "ILOSTAT" | "V-Dem" | "WID" | "IMF") =>
  Effect.gen(function* () {
    const account = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
    const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN")
    const accessKeyId = yield* Config.Redacted("R2_ACCESS_KEY_ID")
    const secretAccessKey = yield* Config.Redacted("R2_SECRET_ACCESS_KEY")
    const database = yield* Config.String(`${source === "V-Dem" ? "VDEM" : source}_D1_ID`)
    const bucket = yield* Config.String(`${source === "V-Dem" ? "VDEM" : source}_R2_BUCKET`)
    const bucketTransport = yield* storage({ account, accessKeyId, secretAccessKey, bucket })

    const gather = Gather.layer.pipe(
      Layer.provide(Sources.layer),
      Layer.provide(Insee.layer),
      Layer.provide(Who.layer),
      Layer.provide(archives(source)),
      Layer.provide(Faostat.layer.pipe(Layer.provide(faoArchive))),
      Layer.provide(Ilostat.layer.pipe(Layer.provide(iloArchive))),
      Layer.provide(WorldBank.layer),
      Layer.provide(Sdmx.layer),
      Layer.provide(Store.r2(bucketTransport)),
      Layer.provide(d1({ account, database, token }).layer),
    )

    yield* Gather.run(source).pipe(Effect.provide(Layer.merge(gather, Step.immediate)))
  }).pipe(
    Effect.provide(
      Pace.paced(Duration.seconds(10)).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(Pace.memory),
      ),
    ),
  )
