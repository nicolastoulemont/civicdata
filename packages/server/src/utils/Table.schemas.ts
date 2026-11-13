import { Schema } from "effect"

// A CSV file whose cells cannot be read, at its first unreadable line.
export class Malformed extends Schema.TaggedError<Malformed, { readonly brand: unique symbol }>()(
  "Malformed",
  { line: Schema.Int },
) {}
