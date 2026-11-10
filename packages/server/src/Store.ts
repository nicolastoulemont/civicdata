// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./cloudflare.d.ts" />

import {
  type Country,
  Dimensions,
  type IndicatorId,
  Observation,
  type Source,
  sourceOf,
  type Year,
} from "@civicdata/domain"
import { Array as Arr, Context, Data, DateTime, Effect, Layer, Option, Order, Schema } from "effect"

import { fingerprint } from "./fingerprint.ts"
import { Described } from "./Series.ts"

// One stored series: an indicator's values for every country and year we
// chart, what the source calls it, when the source was asked, and the
// source's own date for the release the values came from, such as the World
// Development Indicators' last update. An SDMX dataflow holds one series per
// combination of its dimensions' values, such as { sex: "F", age: "Y15-24" }.
export const Stored = Schema.Struct({
  ...Described.fields,
  version: Schema.NonEmptyString,
  dimensions: Schema.optionalKey(Dimensions),
  observations: Schema.Array(Observation),
})

export interface Stored extends Schema.Schema.Type<typeof Stored> {}

const StoredJson = Schema.fromJsonString(Schema.toCodecJson(Stored))

// A series as StoredJson encodes it, built with JSON.stringify: Schema's
// encoding costs about 0.7 ms of CPU for a series of 750 values, this one
// 0.05, and a first pass writes millions. Every read still decodes the object
// with StoredJson.
const encode = ({ indicator, dataset, retrievedAt, version, dimensions, observations }: Stored) =>
  JSON.stringify({
    indicator,
    dataset,
    retrievedAt: DateTime.formatIso(retrievedAt),
    version,
    dimensions,
    observations,
  })

// Country, then year: the order a stored series keeps its observations in.
export const byCountryYear = Order.combine(
  Order.mapInput(Order.String, (observation: Observation) => observation.country),
  Order.mapInput(Order.Number, (observation: Observation) => observation.year),
)

// The SHA-256 of what a series holds, in hex: its values and what the source
// calls them, without when they were fetched or the release date, which
// change on runs that bring nothing new. Observations are sorted first, so
// the same values in another order hash the same. Built with JSON.stringify
// rather than a Schema encoding, which costs five times the CPU for 14,000
// observations.
export const hashOf = ({ indicator, dataset, observations }: Stored) =>
  fingerprint(
    JSON.stringify([
      indicator.id,
      indicator.name,
      indicator.definition,
      dataset,
      Arr.sort(observations, byCountryYear).map(({ country, year, value, flags }) => [
        country,
        year,
        value,
        flags ?? [],
      ]),
    ]),
  )

const folders: Record<Source, string> = {
  "World Bank": "world-bank",
  Eurostat: "eurostat",
  OECD: "oecd",
}

// Which series: an indicator, and for an SDMX dataflow the value of each of
// its dimensions.
export interface Address {
  readonly indicator: IndicatorId
  readonly dimensions?: Dimensions | undefined
}

const folderOf = (indicator: IndicatorId) =>
  `series/v1/${folders[sourceOf(indicator)]}/${indicator}`

// Where a series lives in the bucket: `series/v1/world-bank/<indicator>`, or
// for an SDMX dataflow `series/v1/<source>/<indicator>/<dimension=code,...>`,
// dimensions in id order. Bump the version when what an object holds
// changes, so a reader never decodes an object of another format.
export const keyOf = ({ indicator, dimensions = {} }: Address) =>
  sourceOf(indicator) === "World Bank"
    ? folderOf(indicator)
    : `${folderOf(indicator)}/${Object.entries(dimensions)
        .toSorted(([a], [b]) => (a < b ? -1 : 1))
        .map(([id, code]) => `${id}=${code}`)
        .join(",")}`

const addressOf = (series: Stored): Address => ({
  indicator: series.indicator.id,
  dimensions: series.dimensions,
})

// One page of a bucket listing: the objects under `prefix` after `cursor`,
// with each object's custom metadata.
interface Listing {
  readonly prefix: string
  readonly include: Array<"customMetadata">
  readonly cursor?: string
}

// What the store needs from an R2 bucket binding.
export interface SeriesBucket {
  readonly get: (key: string) => Promise<{ readonly text: () => Promise<string> } | null>
  readonly head: (
    key: string,
  ) => Promise<{ readonly customMetadata?: Record<string, string> | undefined } | null>
  readonly put: (
    key: string,
    value: string,
    options: { readonly customMetadata: Record<string, string> },
  ) => Promise<{ readonly key: string } | null>
  readonly list: (options: Listing) => Promise<
    {
      readonly objects: ReadonlyArray<{
        readonly key: string
        readonly customMetadata?: Record<string, string> | undefined
      }>
    } & ({ readonly truncated: true; readonly cursor: string } | { readonly truncated: false })
  >
}

// The bucket failed to answer or to store.
class StoreUnavailable extends Schema.TaggedError<
  StoreUnavailable,
  { readonly brand: unique symbol }
>()("StoreUnavailable", { cause: Schema.Defect() }) {}

interface Interface {
  // The stored series, if one is stored. An object that no longer decodes
  // counts as none.
  readonly read: (address: Address) => Effect.Effect<Option.Option<Stored>, StoreUnavailable>
  // The hash of the stored series, read without reading the series.
  readonly hash: (address: Address) => Effect.Effect<Option.Option<string>, StoreUnavailable>
  // The hash of every stored series of an SDMX dataflow, by key: one request
  // per thousand series.
  readonly hashes: (
    indicator: IndicatorId,
  ) => Effect.Effect<ReadonlyMap<string, string>, StoreUnavailable>
  // Stores the series with its hash, replacing the stored one.
  readonly write: (series: Stored) => Effect.Effect<void, StoreUnavailable>
}

const attempt = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => new StoreUnavailable({ cause }) })

// Each series as one JSON object in R2, its hash in the object's metadata.
// Unlike the Cache, the store has no expiry and its failures are errors: a
// gathering run must never mistake a bucket that failed for an empty one.
export class Store extends Context.Service<Store, Interface>()("@civicdata/server/Store") {
  static readonly r2 = (bucket: SeriesBucket) =>
    Layer.succeed(
      Store,
      Store.of({
        read: (address) =>
          attempt(() => bucket.get(keyOf(address))).pipe(
            Effect.flatMap((object) =>
              object === null
                ? Effect.succeedNone
                : attempt(() => object.text()).pipe(Effect.asSome),
            ),
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeedNone,
                onSome: (text) =>
                  Schema.decodeEffect(StoredJson)(text).pipe(
                    Effect.asSome,
                    Effect.catchTag("SchemaError", (error) =>
                      Effect.logWarning(
                        "Stored series no longer decodes",
                        keyOf(address),
                        error,
                      ).pipe(Effect.as(Option.none())),
                    ),
                  ),
              }),
            ),
            Effect.withSpan("Store.read"),
          ),
        hash: (address) =>
          attempt(() => bucket.head(keyOf(address))).pipe(
            Effect.map((object) => Option.fromNullishOr(object?.customMetadata?.["hash"])),
          ),
        hashes: (indicator) =>
          Effect.gen(function* () {
            const found = new Map<string, string>()
            const prefix = `${folderOf(indicator)}/`
            let cursor: string | undefined

            do {
              const include: Array<"customMetadata"> = ["customMetadata"]

              const request: Listing =
                cursor === undefined ? { prefix, include } : { prefix, include, cursor }

              const page = yield* attempt(() => bucket.list(request))

              for (const { key, customMetadata } of page.objects) {
                const hash = customMetadata?.["hash"]

                if (hash !== undefined) found.set(key, hash)
              }

              cursor = page.truncated ? page.cursor : undefined
            } while (cursor !== undefined)

            return found
          }).pipe(Effect.withSpan("Store.hashes")),
        write: (series) =>
          Effect.gen(function* () {
            const text = encode(series)
            const hash = yield* hashOf(series)

            yield* attempt(() =>
              bucket.put(keyOf(addressOf(series)), text, { customMetadata: { hash } }),
            )
          }).pipe(Effect.withSpan("Store.write")),
      }),
    )

  // Outside Workers nothing is stored, so every chart asks its source.
  static readonly none = Layer.succeed(
    Store,
    Store.of({
      read: () => Effect.succeedNone,
      hash: () => Effect.succeedNone,
      hashes: () => Effect.succeed(new Map()),
      write: () => Effect.fail(new StoreUnavailable({ cause: "No SERIES bucket" })),
    }),
  )

  // The SERIES bucket inside Workers (deployed, or under `alchemy dev`).
  static readonly layer = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) => (env.SERIES === undefined ? Store.none : Store.r2(env.SERIES))),
      Effect.orElseSucceed(() => Store.none),
    ),
  )
}

// A country and year a series has a value for.
export interface Place {
  readonly country: Country
  readonly year: Year
}

// What to do with a candidate for a stored series. A candidate that is empty
// or loses country-years the stored series has is held back: the stored
// series keeps serving. Revised values and added country-years replace it,
// since sources revise legitimately, sometimes by a lot.
export type Verdict = Data.TaggedEnum<{
  Replace: {}
  Hold: { readonly reason: "Empty" | "Lost"; readonly lost: ReadonlyArray<Place> }
}>

export const Verdict = Data.taggedEnum<Verdict>()

const placeOf = ({ country, year }: Place) => `${country}:${year}`

export const judge = (
  stored: ReadonlyArray<Observation>,
  candidate: ReadonlyArray<Observation>,
): Verdict => {
  const kept = new Set(candidate.map(placeOf))

  const lost = stored.flatMap(({ country, year }) =>
    kept.has(placeOf({ country, year })) ? [] : [{ country, year }],
  )

  if (!Arr.isReadonlyArrayNonEmpty(candidate)) return Verdict.Hold({ reason: "Empty", lost })

  return Arr.isArrayNonEmpty(lost) ? Verdict.Hold({ reason: "Lost", lost }) : Verdict.Replace()
}
