import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"

import { CatalogEntry, SearchText } from "./Catalog.ts"
import {
  CatalogUnavailable,
  IndicatorNotFound,
  SourceUnavailable,
  TransformNotApplicable,
} from "./Errors.ts"
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
      error: [IndicatorNotFound, SourceUnavailable, TransformNotApplicable],
    }),
  )
  .prefix("/views") {}

class Catalog extends HttpApiGroup.make("catalog")
  .add(
    HttpApiEndpoint.get("search", "/search", {
      query: { q: SearchText },
      success: Schema.Array(CatalogEntry),
      error: [SourceUnavailable, CatalogUnavailable],
    }),
  )
  .prefix("/catalog") {}

export class Api extends HttpApi.make("civicdata")
  .add(System)
  .add(Views)
  .add(Catalog)
  .prefix("/api") {}
