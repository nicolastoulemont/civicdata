import { Schema, SchemaGetter } from "effect"

// An SDMX dimension's id, such as Eurostat's "sex" or the OECD's "AGE".
export const DimensionId = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/)).pipe(
  Schema.brand("DimensionId"),
)

export type DimensionId = typeof DimensionId.Type

// One value a dimension takes, such as "T" (total) or "Y15-74".
export const Code = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/)).pipe(
  Schema.brand("Code"),
)

export type Code = typeof Code.Type

const Option = Schema.Struct({ code: Code, label: Schema.NonEmptyString })

// A dimension a dataflow's series differ by, with the values it takes for
// the countries asked, e.g. sex: Females, Males, Total.
export const Dimension = Schema.Struct({
  id: DimensionId,
  label: Schema.NonEmptyString,
  options: Schema.NonEmptyArray(Option),
})

export interface Dimension extends Schema.Schema.Type<typeof Dimension> {}

// The View sets the country, the frequency and the years itself.
const fixed = new Set(["geo", "REF_AREA", "freq", "FREQ", "TIME_PERIOD"])

// The value a View shows of each dimension of an SDMX dataflow, e.g.
// { sex: "T", age: "Y15-74" }.
export const Dimensions = Schema.Record(DimensionId, Code).check(
  Schema.makeFilter(
    (dimensions) =>
      Object.keys(dimensions).every((id) => !fixed.has(id)) ||
      "country, frequency and time are set by the chart",
  ),
)

export type Dimensions = typeof Dimensions.Type

// "sex:T,age:Y15-74" ⇄ { sex: "T", age: "Y15-74" }, as a query parameter.
// Codes and dimension ids hold neither ":" nor ",".
export const DimensionList = Schema.String.pipe(
  Schema.decodeTo(Schema.Record(Schema.String, Schema.String), {
    decode: SchemaGetter.transform((text) =>
      text === "" ? {} : Object.fromEntries(text.split(",").map((pair) => pair.split(":"))),
    ),
    encode: SchemaGetter.transform((dimensions) =>
      Object.entries(dimensions)
        .map(([id, code]) => `${id}:${code}`)
        .join(","),
    ),
  }),
  Schema.decodeTo(Dimensions),
)
