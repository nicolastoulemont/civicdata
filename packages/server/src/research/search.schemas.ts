import { Country } from "@repo/domain"
import { Schema } from "effect"

import { Scope } from "./annotation.schemas.ts"

const Period = Schema.Struct({
  from: Scope.fields.periods.value.fields.from,
  to: Scope.fields.periods.value.fields.to,
}).check(Schema.makeFilter(({ from, to }) => from <= to || "from must not be after to"))

export const Question = Schema.Struct({
  text: Schema.NonEmptyString,
  countries: Schema.Array(Country),
  period: Schema.NullOr(Period),
  intent: Schema.Literals(["Evidence", "Cause"]),
})

export interface Question extends Schema.Schema.Type<typeof Question> {}
