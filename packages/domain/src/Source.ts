import { Schema } from "effect"

// Publisher names are also registry keys and visible chart credits. A colon
// separates a publisher from its native code, so it cannot occur in a name.
export const Source = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+)*$/),
)

export type Source = typeof Source.Type

export const NativeId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_@.,-]*$/),
).pipe(Schema.brand("NativeId"))

export type NativeId = typeof NativeId.Type

// Deployed ids retain their bytes. Only the three deployed forms can omit
// their publisher; new publishers always use "Publisher:native-code".
export const IndicatorId = Schema.String.check(
  Schema.isPattern(
    /^(?:[A-Za-z0-9][A-Za-z0-9._-]*|(?:ESTAT|OECD(?:\.[A-Z0-9]+)*),[A-Za-z0-9][A-Za-z0-9_@.-]*,[0-9]+(?:\.[0-9]+)*|(?!(?:World Bank|Eurostat|OECD):)[A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+)*:[A-Za-z0-9][A-Za-z0-9_@.,-]*)$/,
  ),
).pipe(Schema.brand("IndicatorId"))

export type IndicatorId = typeof IndicatorId.Type

export const sourceOf = (indicator: IndicatorId): Source => {
  const separator = indicator.indexOf(":")

  if (separator !== -1) return Source.make(indicator.slice(0, separator))

  if (indicator.startsWith("ESTAT,")) return "Eurostat"

  return indicator.includes(",") ? "OECD" : "World Bank"
}

export const nativeId = (indicator: IndicatorId): NativeId =>
  NativeId.make(indicator.slice(indicator.indexOf(":") + 1))

// Adapters construct ids here, then use nativeId when calling their publisher.
// The common new-source call is identify("INSEE", NativeId.make("CODE")).
export const identify = (source: Source, native: NativeId): IndicatorId => {
  Source.make(source)
  const legacy = source === "World Bank" || source === "Eurostat" || source === "OECD"
  const id = IndicatorId.make(legacy ? native : `${source}:${native}`)

  if (sourceOf(id) !== source) throw new Error(`Native code does not belong to ${source}`)

  return id
}
