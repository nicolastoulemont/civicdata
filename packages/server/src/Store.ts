// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./cloudflare.d.ts" />

import {
  type Country,
  type IndicatorId,
  Observation,
  type Source,
  sourceOf,
  type Year,
} from "@civicdata/domain"
import { Array as Arr, Context, Data, Effect, Layer, Option, Order, Schema, Struct } from "effect"

import { fingerprint } from "./fingerprint.ts"
import { Described } from "./Series.ts"

// One stored series: an indicator's values for every country and year we
// chart, what the source calls it, when the source was asked, and the
// source's own date for the release the values came from, such as the World
// Development Indicators' last update.
export const Stored = Schema.Struct({
  ...Described.fields,
  version: Schema.NonEmptyString,
  observations: Schema.Array(Observation),
})

export interface Stored extends Schema.Schema.Type<typeof Stored> {}

const StoredJson = Schema.fromJsonString(Schema.toCodecJson(Stored))

// What a hash covers: the values and what the source calls them, without when
// they were fetched or the release date, which change on runs that bring
// nothing new.
const PrintJson = Schema.fromJsonString(
  Schema.toCodecJson(Stored.mapFields(Struct.omit(["retrievedAt", "version"]))),
)

// Country, then year: the order a stored series keeps its observations in.
export const byCountryYear = Order.combine(
  Order.mapInput(Order.String, (observation: Observation) => observation.country),
  Order.mapInput(Order.Number, (observation: Observation) => observation.year),
)

// The SHA-256 of what a series holds, in hex. Observations are sorted first,
// so the same values in another order hash the same.
export const hashOf = (series: Stored) =>
  Schema.encodeEffect(PrintJson)({
    indicator: series.indicator,
    dataset: series.dataset,
    observations: Arr.sort(series.observations, byCountryYear),
  }).pipe(Effect.orDie, Effect.flatMap(fingerprint))

const folders: Record<Source, string> = {
  "World Bank": "world-bank",
  Eurostat: "eurostat",
  OECD: "oecd",
}

// Where a series lives in the bucket: `series/v1/<source>/<indicator>`.
// Eurostat and OECD series will add their dimension values after the
// indicator. Bump the version when what an object holds changes, so a reader
// never decodes an object of another format.
export const keyOf = (indicator: IndicatorId) =>
  `series/v1/${folders[sourceOf(indicator)]}/${indicator}`

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
}

// The bucket failed to answer or to store.
class StoreUnavailable extends Schema.TaggedError<
  StoreUnavailable,
  { readonly brand: unique symbol }
>()("StoreUnavailable", { cause: Schema.Defect() }) {}

interface Interface {
  // The stored series of the indicator, if one is stored. An object that no
  // longer decodes counts as none.
  readonly read: (indicator: IndicatorId) => Effect.Effect<Option.Option<Stored>, StoreUnavailable>
  // The hash of the stored series, read without reading the series.
  readonly hash: (indicator: IndicatorId) => Effect.Effect<Option.Option<string>, StoreUnavailable>
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
        read: (indicator) =>
          attempt(() => bucket.get(keyOf(indicator))).pipe(
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
                      Effect.logWarning("Stored series no longer decodes", indicator, error).pipe(
                        Effect.as(Option.none()),
                      ),
                    ),
                  ),
              }),
            ),
            Effect.withSpan("Store.read"),
          ),
        hash: (indicator) =>
          attempt(() => bucket.head(keyOf(indicator))).pipe(
            Effect.map((object) => Option.fromNullishOr(object?.customMetadata?.["hash"])),
          ),
        write: (series) =>
          Effect.gen(function* () {
            const text = yield* Schema.encodeEffect(StoredJson)(series).pipe(Effect.orDie)
            const hash = yield* hashOf(series)

            yield* attempt(() =>
              bucket.put(keyOf(series.indicator.id), text, { customMetadata: { hash } }),
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
