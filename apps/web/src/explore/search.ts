import {
  Change,
  Country,
  Dimensions,
  IndicatorId,
  Ranking,
  Ratio,
  Relation,
  type Transform,
  Trend,
  type View,
  Year,
} from "@civicdata/domain"
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router"
import { Match, Schema } from "effect"

import { withPicks, withTransform } from "./edits.ts"
import { Overlay } from "./politics.ts"

// The View as readable URL parameters:
// ?chart=trend&indicator=SP.POP.TOTL&countries=FRA,DEU&from=2000&to=2022&transform=index
// ?chart=relation&indicator=SP.DYN.LE00.IN&against=NY.GDP.PCAP.CD&countries=FRA,DEU&year=2022
// A ratio names the indicator it divides by: &transform=ratio&per=NY.GDP.MKTP.CD
// A ranking drawn as a world map adds &as=map. An SDMX indicator adds the
// value of each dimension: &dimensions=sex:T,age:Y15-74
// A trend lists what it draws over its lines besides the View, outside it:
// &overlays=governments
const Search = Schema.Union([
  Schema.Struct({
    chart: Schema.Literal("trend"),
    indicator: IndicatorId,
    countries: Schema.String,
    from: Year,
    to: Year,
    transform: Schema.optionalKey(Schema.Literals(["per-person", "growth", "index", "ratio"])),
    per: Schema.optionalKey(IndicatorId),
    dimensions: Schema.optionalKey(Schema.String),
    overlays: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    chart: Schema.Literal("ranking"),
    indicator: IndicatorId,
    countries: Schema.String,
    year: Year,
    transform: Schema.optionalKey(Schema.Literals(["per-person", "growth", "ratio"])),
    per: Schema.optionalKey(IndicatorId),
    as: Schema.optionalKey(Schema.Literal("map")),
    dimensions: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    chart: Schema.Literal("change"),
    indicator: IndicatorId,
    countries: Schema.String,
    from: Year,
    to: Year,
    transform: Schema.optionalKey(Schema.Literals(["per-person", "ratio"])),
    per: Schema.optionalKey(IndicatorId),
    dimensions: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    chart: Schema.Literal("relation"),
    indicator: IndicatorId,
    against: IndicatorId,
    countries: Schema.String,
    year: Year,
    dimensions: Schema.optionalKey(Schema.String),
  }),
])

const fromParam = { "per-person": "PerPerson", growth: "Growth", index: "Index" } as const
const toParam = { PerPerson: "per-person", Growth: "growth", Index: "index" } as const

const isRatio = Schema.is(Ratio)

type Params<P> = { readonly transform?: P; readonly per?: IndicatorId }

// The transform as link parameters, none without one. Each chart type takes
// only the parameters for its own transforms.
function transformParams(transform: Change["transform"]): Params<"per-person" | "ratio">
function transformParams(
  transform: (typeof Ranking.Type)["transform"],
): Params<"per-person" | "growth" | "ratio">
function transformParams(
  transform: Transform | undefined,
): Params<"per-person" | "growth" | "index" | "ratio">
function transformParams(transform: Transform | undefined) {
  if (transform === undefined) return {}

  if (isRatio(transform)) return { transform: "ratio", per: transform.per }

  return { transform: toParam[transform] }
}

// A ranking drawn as a map as link parameters, none for bars.
const drawnParams = (as: "Map" | undefined): { readonly as?: "map" } =>
  as === undefined ? {} : { as: "map" }

// The transform a link names. Throws when a ratio lacks the indicator it
// divides by, or another transform names one.
const transformOfParams = ({
  transform,
  per,
}: {
  readonly transform?: keyof typeof fromParam | "ratio"
  readonly per?: IndicatorId
}): Transform | undefined => {
  if (transform === "ratio" && per !== undefined) return Ratio.make({ per })

  if (transform === "ratio" || per !== undefined) throw new Error("per goes with transform=ratio")

  return transform === undefined ? undefined : fromParam[transform]
}

export type Search = typeof Search.Encoded

const countryList = Schema.decodeUnknownSync(Schema.NonEmptyArray(Country))

const dimensionList = Schema.decodeUnknownSync(Dimensions)

// "sex:T,age:Y15-74" ⇄ { sex: "T", age: "Y15-74" }. Codes and dimension ids
// hold neither ":" nor ",".
const dimensionParams = (dimensions: Dimensions | undefined): { readonly dimensions?: string } =>
  dimensions === undefined || Object.keys(dimensions).length === 0
    ? {}
    : {
        dimensions: Object.entries(dimensions)
          .map(([id, code]) => `${id}:${code}`)
          .join(","),
      }

// Sets the dimensions a link names on the View it describes.
const picking = (view: View, param: string | undefined) =>
  param === undefined
    ? view
    : withPicks(
        view,
        dimensionList(Object.fromEntries(param.split(",").map((pair) => pair.split(":")))),
      )

// Throws on a link that does not describe a valid View, which the route turns
// into its error page. The `make` constructors reject duplicate countries,
// years that run backwards and a relation of an indicator to itself.
export const toView = (search: Search): View =>
  Match.value(Schema.decodeSync(Search)(search)).pipe(
    Match.when({ chart: "trend" }, ({ indicator, countries, from, to, dimensions, ...params }) =>
      picking(
        withTransform(
          Trend.make({ indicator, countries: countryList(countries.split(",")), from, to }),
          transformOfParams(params),
        ),
        dimensions,
      ),
    ),
    Match.when({ chart: "ranking" }, ({ indicator, countries, year, as, dimensions, ...params }) =>
      picking(
        withTransform(
          as === undefined
            ? Ranking.make({ indicator, countries: countryList(countries.split(",")), year })
            : Ranking.make({
                indicator,
                countries: countryList(countries.split(",")),
                year,
                as: "Map",
              }),
          transformOfParams(params),
        ),
        dimensions,
      ),
    ),
    Match.when({ chart: "change" }, ({ indicator, countries, from, to, dimensions, ...params }) =>
      picking(
        withTransform(
          Change.make({ indicator, countries: countryList(countries.split(",")), from, to }),
          transformOfParams(params),
        ),
        dimensions,
      ),
    ),
    Match.when({ chart: "relation" }, ({ indicator, against, countries, year, dimensions }) =>
      picking(
        Relation.make({ indicator, against, countries: countryList(countries.split(",")), year }),
        dimensions,
      ),
    ),
    Match.exhaustive,
  )

const overlayList = Schema.decodeUnknownSync(Schema.Array(Overlay))

// What a trend draws over its lines as a link parameter, none without any.
const overlayParams = (overlays: ReadonlyArray<Overlay>): { readonly overlays?: string } =>
  overlays.length === 0 ? {} : { overlays: overlays.join(",") }

// What a link turns on over its trend. Throws on an overlay it does not know,
// like toView on a View it does not describe.
export const toOverlays = (search: Search): ReadonlyArray<Overlay> =>
  search.chart === "trend" && search.overlays !== undefined
    ? overlayList(search.overlays.split(","))
    : []

// The View and, for a trend, what is drawn over it, as link parameters.
export const toSearch = (view: View, overlays: ReadonlyArray<Overlay> = []): Search =>
  Match.valueTags(view, {
    Trend: ({ indicator, countries, from, to, transform, dimensions }) => ({
      chart: "trend" as const,
      indicator,
      countries: countries.join(","),
      from,
      to,
      ...transformParams(transform),
      ...dimensionParams(dimensions),
      ...overlayParams(overlays),
    }),
    Ranking: ({ indicator, countries, year, transform, as, dimensions }) => ({
      chart: "ranking" as const,
      indicator,
      countries: countries.join(","),
      year,
      ...transformParams(transform),
      ...drawnParams(as),
      ...dimensionParams(dimensions),
    }),
    Change: ({ indicator, countries, from, to, transform, dimensions }) => ({
      chart: "change" as const,
      indicator,
      countries: countries.join(","),
      from,
      to,
      ...transformParams(transform),
      ...dimensionParams(dimensions),
    }),
    Relation: ({ indicator, against, countries, year, dimensions }) => ({
      chart: "relation" as const,
      indicator,
      against,
      countries: countries.join(","),
      year,
      ...dimensionParams(dimensions),
    }),
  })

// The View in a URL's query string, read the way the router reads /explore's.
// Throws like toView.
export const fromUrl = (url: URL) =>
  toView(Schema.decodeUnknownSync(Schema.toEncoded(Search))(defaultParseSearch(url.search)))

// The query string for a View and its overlays, "?chart=...", written the
// way the router writes it.
export const toQuery = (view: View, overlays: ReadonlyArray<Overlay> = []) =>
  defaultStringifySearch(toSearch(view, overlays))
