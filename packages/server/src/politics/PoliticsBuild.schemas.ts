import { Schema } from "effect"

import { Dataset } from "./Politics.schemas.ts"

// A build that left some datasets on their previous generation.
export class PoliticsBuildFailed extends Schema.TaggedError<
  PoliticsBuildFailed,
  { readonly brand: unique symbol }
>()("PoliticsBuildFailed", {
  datasets: Schema.Array(Dataset),
}) {}
