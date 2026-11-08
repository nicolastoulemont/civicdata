import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"

import { IndicatorNotFound, SourceUnavailable } from "./Errors.ts"
import { ResolvedView } from "./ResolvedView.ts"
import { View } from "./View.ts"

class System extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", { success: HttpApiSchema.NoContent }),
) {}

class Views extends HttpApiGroup.make("views")
  .add(
    HttpApiEndpoint.post("resolve", "/resolve", {
      payload: View,
      success: ResolvedView,
      error: [IndicatorNotFound, SourceUnavailable],
    }),
  )
  .prefix("/views") {}

export class Api extends HttpApi.make("civicdata").add(System).add(Views).prefix("/api") {}
