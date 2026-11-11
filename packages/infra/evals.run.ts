import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"

// A separate stack: closing an app preview must never remove paid run results.
export default Alchemy.Stack(
  "civicdata-evals",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.Bucket("Archive", {
      name: "civicdata-evals",
      publicAccess: false,
      forceDestroy: false,
    }).pipe(Alchemy.RemovalPolicy.retain())

    return { bucket: bucket.bucketName }
  }),
)
