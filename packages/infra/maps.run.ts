import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"

// Map vintages outlive app previews. This stack never deletes stored geometry.
export default Alchemy.Stack(
  "openfacts-maps",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.Bucket("Archive", {
      name: "openfacts-maps",
      publicAccess: false,
      forceDestroy: false,
      domains: [{ name: "maps.openfacts.app", zone: "openfacts.app" }],
    }).pipe(Alchemy.RemovalPolicy.retain())

    return { bucket: bucket.bucketName, origin: "https://maps.openfacts.app" }
  }),
)
