import { Schema } from "effect"

// D1 failed, the Worker binds no DB, or the table holds a row the writer
// never writes.
export class DemandUnavailable extends Schema.TaggedError<
  DemandUnavailable,
  { readonly brand: unique symbol }
>()("DemandUnavailable", { cause: Schema.Defect() }) {}
