// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./cloudflare.d.ts" />

import {
  codesOf,
  type Country,
  Dimensions,
  Indicator,
  type IndicatorId,
  Observation,
  type SeriesKey,
  sourceOf,
  SourceUnavailable,
  type Year,
} from "@civicdata/domain"
import { Array as Arr, Context, Data, Effect, Layer, Option, Order, Schema, Stream } from "effect"

import { fingerprint } from "./fingerprint.ts"
import { Described } from "./Series.ts"

// One stored series: its values for every country and year we chart, what
// the source calls its indicator, the value of each of its dimensions, when
// the source was asked, and the source's own date for the release the values
// came from, such as the World Development Indicators' last update.
export const Stored = Schema.Struct({
  ...Described.fields,
  dimensions: Dimensions,
  version: Schema.NonEmptyString,
  observations: Schema.Array(Observation),
})

export interface Stored extends Schema.Schema.Type<typeof Stored> {}

// Country, then year: the order a stored series keeps its observations in.
const byCountryYear = Order.combine(
  Order.mapInput(Order.String, (observation: Observation) => observation.country),
  Order.mapInput(Order.Number, (observation: Observation) => observation.year),
)

// The series' key: its indicator and dimensions.
export const keyOf = (series: Stored): SeriesKey => ({
  indicator: series.indicator.id,
  dimensions: series.dimensions,
})

// A series as a pack holds it: without the indicator and dataset, which the
// pack holds once for all its series.
const Part = Schema.Struct({
  dimensions: Dimensions,
  version: Schema.NonEmptyString,
  retrievedAt: Schema.DateTimeUtc,
  observations: Schema.Array(Observation),
})

const PartJson = Schema.toCodecJson(Part)

// One series in a pack: its codes (`codesOf` its dimensions), the hash of its
// values, and the series, which a reader decodes only once it picks it.
const Element = Schema.Tuple([Schema.String, Schema.String, Schema.Unknown])

type Element = typeof Element.Type

// One R2 object of series of one catalog entry, sorted by codes.
const Pack = Schema.TaggedStruct("Pack", {
  indicator: Indicator,
  dataset: Schema.String,
  series: Schema.Array(Element),
})

type Pack = typeof Pack.Type

// The packs of an entry whose series fill more than one: each pack's first
// codes and hash, sorted by codes.
const Index = Schema.TaggedStruct("Index", {
  packs: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
})

// What the entry's object holds: its one pack, or the index of its packs.
const Entry = Schema.Union([Pack, Index]).pipe(Schema.toTaggedUnion("_tag"))

const EntryJson = Schema.fromJsonString(Entry)

const PackJson = Schema.fromJsonString(Pack)

// A pack is cut once its JSON would pass this many characters. A chart reads
// one pack, so the size trades the bytes and parse time of a read against
// the number of objects: at 1 MB a dataflow of 1 GB is a thousand objects.
const size = 1_000_000

// The SHA-256 of a series' values, which a pack keeps beside each series so
// that a gather can tell an unchanged series without decoding it. Built with
// JSON.stringify rather than a Schema encoding, which costs five times the
// CPU for 14,000 observations.
const hashOf = (observations: ReadonlyArray<Observation>) =>
  fingerprint(
    JSON.stringify(
      observations.map(({ country, year, value, flags }) => [country, year, value, flags ?? []]),
    ),
  )

// The folder of every object the store writes, which names the format they
// hold. Bump its version when what an object holds changes, so a reader
// never decodes an object of another format, and the gather, which records
// each release under it, stores every series again.
export const layout = "series/v2"

// The object an entry lives in, in the bucket: `<layout>/<source>/<indicator>`.
// The source's folder is its name in lower case, words joined by "-", such
// as "world-bank". The object holds the entry's one pack, or the index of its
// packs, each of which lives at `<object>/<hash>`.
const objectOf = (indicator: IndicatorId) =>
  `${layout}/${sourceOf(indicator).toLowerCase().replaceAll(" ", "-")}/${indicator}`

const packOf = (indicator: IndicatorId, hash: string) => `${objectOf(indicator)}/${hash}`

// The last of the sorted items whose codes come at or before `codes`, or -1.
const floor = <A>(items: ReadonlyArray<A>, codes: string, codesAt: (item: A) => string) => {
  let [low, high, found] = [0, items.length - 1, -1]

  while (low <= high) {
    const middle = (low + high) >> 1
    const item = items[middle]

    if (item !== undefined && codesAt(item) <= codes) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return found
}

// A pack's text, its series' elements already JSON.
const textOf = (
  { indicator, dataset }: Pick<Stored, "indicator" | "dataset">,
  elements: ReadonlyArray<string>,
) =>
  `{"_tag":"Pack","indicator":${JSON.stringify(indicator)},"dataset":${JSON.stringify(dataset)},"series":[${elements.join(",")}]}`

// What the store needs from an R2 bucket binding.
export interface SeriesBucket {
  readonly get: (key: string) => Promise<{
    readonly text: () => Promise<string>
    readonly customMetadata?: Record<string, string> | undefined
  } | null>
  readonly put: (
    key: string,
    value: string,
    options: {
      readonly customMetadata: Record<string, string>
      readonly onlyIf?: { readonly etagDoesNotMatch: string }
    },
  ) => Promise<{ readonly key: string } | null>
  readonly delete: (keys: Array<string>) => Promise<void>
}

// The bucket failed to answer or to store.
class StoreUnavailable extends Schema.TaggedError<
  StoreUnavailable,
  { readonly brand: unique symbol }
>()("StoreUnavailable", { cause: Schema.Defect() }) {}

// A country and year a series has a value for.
export interface Place {
  readonly country: Country
  readonly year: Year
}

// What to do with a candidate for a stored series. A candidate that is empty
// or loses country-years the stored series has is held back: the stored
// series keeps serving. Revised values and added country-years replace it,
// since sources revise legitimately, sometimes by a lot.
type Verdict = Data.TaggedEnum<{
  Replace: {}
  Hold: { readonly reason: "Empty" | "Lost"; readonly lost: ReadonlyArray<Place> }
}>

const Verdict = Data.taggedEnum<Verdict>()

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

// What a write did with one candidate: stored it, kept the stored series
// because it holds the same values, or held it back.
export type Outcome = Data.TaggedEnum<{
  Stored: {}
  Unchanged: {}
  Held: { readonly reason: "Empty" | "Lost"; readonly lost: ReadonlyArray<Place> }
}>

export const Outcome = Data.taggedEnum<Outcome>()

// A candidate, its observations sorted by country and year, and what the
// write did with it.
export interface Offer {
  readonly candidate: Stored
  readonly outcome: Outcome
}

interface Interface {
  readonly namespace: (name: string) => Interface
  // The stored series of the key, if one is stored. An object that no longer
  // decodes counts as none.
  readonly read: (key: SeriesKey) => Effect.Effect<Option.Option<Stored>, StoreUnavailable>
  // Merges candidates for the entry's series into the store, as they arrive,
  // and answers what it did with each. The candidates come sorted by their
  // dimensions' codes, each once. A stored series with no candidate stays.
  // A candidate with the stored values keeps the stored series, and one that
  // would lose values is held back (`judge`); a pack whose series all stay
  // costs no write.
  readonly write: <E>(
    indicator: IndicatorId,
    candidates: Stream.Stream<Stored, E>,
  ) => Stream.Stream<Offer, E | StoreUnavailable | SourceUnavailable>
}

const attempt = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => new StoreUnavailable({ cause }) })

// A stored pack's place in its entry: its first codes and its hash.
type Placed = readonly [first: string, hash: string]

// The stored series of the range a write is in, and the next one not yet
// passed.
interface Current {
  series: ReadonlyArray<Element>
  next: number
}

// Each catalog entry's series in packs of about 1 MB of JSON, sorted by their
// dimensions' codes. An entry whose series fit one pack is that pack, so a
// chart costs one read; a larger one is an index of its packs, each at its
// hash, so a chart costs two. Unlike the Cache, the store has no expiry and
// its failures are errors: a gathering run must never mistake a bucket that
// failed for an empty one.
export class Store extends Context.Service<Store, Interface>()("@civicdata/server/Store") {
  static readonly r2 = (bucket: SeriesBucket) => Layer.succeed(Store, Store.make(bucket))

  private static readonly make = (bucket: SeriesBucket): Interface => {
    const namespace = (name: string): Interface => {
      const prefix = `releases/${name}/`

      const scoped = {
        get: (key: string) => bucket.get(prefix + key),
        put: async (
          key: string,
          value: string,
          options: { readonly customMetadata: Record<string, string> },
        ) => {
          const written = await bucket.put(prefix + key, value, {
            ...options,
            onlyIf: { etagDoesNotMatch: "*" },
          })

          if (written !== null) return written
          const kept = await bucket.get(prefix + key)

          if (kept !== null && (await kept.text()) === value) return { key: prefix + key }
          throw new Error("Release objects are immutable")
        },
        // Failed attempts and old pinned releases retain their packs.
        delete: () => Promise.resolve(),
      }

      return Store.make(scoped)
    }

    const get = (object: string) =>
      attempt(() => bucket.get(object)).pipe(
        Effect.flatMap((found) =>
          found === null
            ? Effect.succeedNone
            : attempt(() => found.text()).pipe(
                Effect.map((text) => Option.some({ text, hash: found.customMetadata?.["hash"] })),
              ),
        ),
      )

    const put = (object: string, { text, hash }: { text: string; hash: string }) =>
      attempt(async () => {
        const result = await bucket.put(object, text, { customMetadata: { hash } })

        if (result === null) throw new Error("The bucket did not store the object")

        return result
      })

    // The pack of an indexed entry, or none when it is gone or no longer
    // decodes.
    const packAt = (indicator: IndicatorId, hash: string) =>
      get(packOf(indicator, hash)).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeedNone,
            onSome: ({ text }) => Effect.asSome(Schema.decodeEffect(PackJson)(text)),
          }),
        ),
        Effect.catchTag("SchemaError", (error) =>
          Effect.logWarning("Stored pack no longer decodes", indicator, hash, error).pipe(
            Effect.as(Option.none<Pack>()),
          ),
        ),
      )

    const read = Effect.fn("Store.read")(
      function* (key: SeriesKey) {
        const codes = codesOf(key.dimensions)
        const found = yield* get(objectOf(key.indicator))

        if (Option.isNone(found)) return Option.none<Stored>()

        const entry = yield* Schema.decodeEffect(EntryJson)(found.value.text)

        const pack: Option.Option<Pack> = yield* Entry.match(entry, {
          Pack: (single) => Effect.succeedSome(single),
          Index: ({ packs }) => {
            const placed = packs[floor(packs, codes, ([first]) => first)]

            return placed === undefined ? Effect.succeedNone : packAt(key.indicator, placed[1])
          },
        })

        if (Option.isNone(pack)) return Option.none<Stored>()

        const { indicator, dataset, series } = pack.value
        const element = series[floor(series, codes, ([first]) => first)]

        if (element === undefined || element[0] !== codes) return Option.none<Stored>()

        const part = yield* Schema.decodeUnknownEffect(PartJson)(element[2])

        return Option.some({ indicator, dataset, ...part })
      },
      Effect.catchTag("SchemaError", (error) =>
        Effect.logWarning("Stored series no longer decodes", error).pipe(
          Effect.as(Option.none<Stored>()),
        ),
      ),
    )

    const write = <E>(indicator: IndicatorId, candidates: Stream.Stream<Stored, E>) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const object = objectOf(indicator)
          const found = yield* get(object)

          const entry = yield* Option.match(found, {
            onNone: () => Effect.succeedNone,
            onSome: ({ text }) =>
              Effect.asSome(Schema.decodeEffect(EntryJson)(text)).pipe(
                Effect.catchTag("SchemaError", (error) =>
                  Effect.logWarning("Stored entry no longer decodes", indicator, error).pipe(
                    Effect.as(Option.none<typeof Entry.Type>()),
                  ),
                ),
              ),
          })

          const packer = packing(
            indicator,
            Option.map(entry, (decoded) => ({
              entry: decoded,
              hash: Option.getOrElse(
                Option.flatMapNullishOr(found, ({ hash }) => hash),
                () => "",
              ),
            })),
          )

          return candidates.pipe(
            Stream.mapEffect(packer.offer),
            Stream.concat(Stream.fromEffectDrain(packer.finish)),
            Stream.onError(() => packer.discard),
          )
        }),
      ).pipe(Stream.withSpan("Store.write", { attributes: { indicator } }))

    // The state of one write over the entry's existing object and its hash:
    // the stored range it is in, the pack it is filling, and the packs it
    // has placed. Packs never cross a stored range, so the same series in a
    // range cut into the same packs, and a range no candidate falls in is
    // kept as it is, unread.
    const packing = (
      indicator: IndicatorId,
      existing: Option.Option<{ entry: typeof Entry.Type; hash: string }>,
    ) => {
      // The stored packs, in order: one range of codes each, from its first
      // codes to the next pack's. A single pack has been read already; an
      // indexed one is read once a candidate falls in it.
      const ranges = Option.match(existing, {
        onNone: (): ReadonlyArray<{ placed: Placed; pack: Option.Option<Pack> }> => [],
        onSome: ({ entry, hash }) =>
          Entry.match(entry, {
            Pack: (single) => [
              { placed: [single.series[0]?.[0] ?? "", hash] as const, pack: Option.some(single) },
            ],
            Index: ({ packs }) => packs.map((placed) => ({ placed, pack: Option.none<Pack>() })),
          }),
      })

      const single = Option.exists(existing, ({ entry }) => Entry.guards.Pack(entry))

      // The packs stored at `<object>/<hash>`, which a new pack with the
      // same hash reuses.
      const indexed = new Set(single ? [] : ranges.map(({ placed: [, hash] }) => hash))

      const object = objectOf(indicator)
      const placed: Array<Placed> = []
      // Packs this write stored at their hash, removed if it fails before
      // its index is stored.
      const written: Array<string> = []
      let header: Option.Option<Pick<Stored, "indicator" | "dataset">> = Option.none()
      let last: Option.Option<string> = Option.none()
      let at = -1
      let current: Current = { series: [], next: 0 }
      let filling: { first: string; elements: Array<string>; size: number } | null = null
      // The first pack this write cut, kept until a second pack shows
      // whether the entry is one pack or an index.
      let pending: { placed: Placed; text: string } | null = null
      let committed = false

      const store = Effect.fnUntraced(function* (hash: string, text: string) {
        if (indexed.has(hash)) return

        yield* put(packOf(indicator, hash), { text, hash })
        written.push(hash)
      })

      const place = Effect.fnUntraced(function* (pack: Placed, text: Option.Option<string>) {
        if (pending !== null) {
          yield* store(pending.placed[1], pending.text)
          pending = null
        }

        if (Arr.isArrayNonEmpty(placed)) {
          if (Option.isSome(text)) yield* store(pack[1], text.value)
        } else if (Option.isSome(text)) {
          pending = { placed: pack, text: text.value }
        }

        placed.push(pack)
      })

      const cut = Effect.fnUntraced(function* () {
        if (filling === null || Option.isNone(header)) return

        const text = textOf(header.value, filling.elements)
        const hash = yield* fingerprint(text)
        const first = filling.first

        filling = null
        yield* place([first, hash], Option.some(text))
      })

      const add = Effect.fnUntraced(function* (codes: string, element: string) {
        if (filling !== null && filling.size + element.length > size) yield* cut()

        filling ??= { first: codes, elements: [], size: 0 }
        filling.elements.push(element)
        filling.size += element.length + 1
      })

      // Adds the current range's stored series that come before `codes`,
      // all of them by default.
      const keep = Effect.fnUntraced(function* (codes?: string) {
        while (current.next < current.series.length) {
          const element = current.series[current.next]

          if (element === undefined || (codes !== undefined && element[0] >= codes)) return

          yield* add(element[0], JSON.stringify(element))
          current.next += 1
        }
      })

      // Closes the current range and moves to range `to`, keeping the
      // ranges between them as they are.
      const enter = Effect.fnUntraced(function* (to: number) {
        if (at >= 0) {
          yield* keep()
          yield* cut()
        }

        for (const range of ranges.slice(at + 1, to)) yield* place(range.placed, Option.none())

        at = to

        const range = ranges[to]

        const pack =
          range === undefined
            ? Option.none<Pack>()
            : Option.isSome(range.pack)
              ? range.pack
              : yield* packAt(indicator, range.placed[1])

        current = {
          series: Option.match(pack, { onNone: () => [], onSome: ({ series }) => series }),
          next: 0,
        }
      })

      // The candidate's codes, once it is checked to belong to the entry and
      // to come after the previous one.
      const follow = Effect.fnUntraced(function* (offered: Stored) {
        const codes = codesOf(offered.dimensions)

        if (offered.indicator.id !== indicator) {
          return yield* new SourceUnavailable({ source: sourceOf(indicator) })
        }

        if (Option.exists(last, (previous) => previous >= codes)) {
          return yield* new SourceUnavailable({ source: sourceOf(indicator) })
        }

        last = Option.some(codes)

        if (Option.isNone(header)) {
          header = Option.some({ indicator: offered.indicator, dataset: offered.dataset })
        }

        return codes
      })

      // The stored series with the codes, after adding the stored series
      // before it.
      const counterpart = Effect.fnUntraced(function* (codes: string) {
        const to = Math.max(
          0,
          floor(ranges, codes, ({ placed: [first] }) => first),
        )

        if (to !== at) yield* enter(to)

        yield* keep(codes)

        const element = current.series[current.next]

        if (element === undefined || element[0] !== codes) return Option.none<Element>()

        current.next += 1

        return Option.some(element)
      })

      // The stored series' values, none when it no longer decodes.
      const valuesOf = (stored: Option.Option<Element>, codes: string) =>
        Option.match(stored, {
          onNone: () => Effect.succeed<ReadonlyArray<Observation>>([]),
          onSome: ([, , part]) =>
            Schema.decodeUnknownEffect(PartJson)(part).pipe(
              Effect.map(({ observations }) => observations),
              Effect.catchTag("SchemaError", (error) =>
                Effect.logWarning("Stored series no longer decodes", indicator, codes, error).pipe(
                  Effect.as([]),
                ),
              ),
            ),
        })

      const offer = Effect.fnUntraced(function* (offered: Stored) {
        const codes = yield* follow(offered)
        const stored = yield* counterpart(codes)
        const { indicator: named, dataset, dimensions, version, retrievedAt } = offered
        const observations = Arr.sort(offered.observations, byCountryYear)

        const candidate = {
          indicator: named,
          dataset,
          dimensions,
          version,
          retrievedAt,
          observations,
        }

        const hash = yield* hashOf(observations)
        const kept = Option.map(stored, (element) => JSON.stringify(element))

        if (Option.isSome(kept) && Option.exists(stored, ([, held]) => held === hash)) {
          yield* add(codes, kept.value)

          return { candidate, outcome: Outcome.Unchanged() } satisfies Offer
        }

        const verdict = judge(yield* valuesOf(stored, codes), observations)

        if (Verdict.$is("Hold")(verdict)) {
          if (Option.isSome(kept)) yield* add(codes, kept.value)

          const { reason, lost } = verdict

          return { candidate, outcome: Outcome.Held({ reason, lost }) } satisfies Offer
        }

        const part = yield* Schema.encodeEffect(PartJson)({
          dimensions,
          version,
          retrievedAt,
          observations,
        }).pipe(Effect.orDie)

        yield* add(codes, JSON.stringify([codes, hash, part]))

        return { candidate, outcome: Outcome.Stored() } satisfies Offer
      })

      // Whether the packs placed are the stored index's, in order.
      const same = () =>
        !single &&
        placed.length === ranges.length &&
        placed.every(
          ([codes, hash], index) =>
            ranges[index]?.placed[0] === codes && ranges[index]?.placed[1] === hash,
        )

      // Stores the entry's object: its one pack, or the index of its packs,
      // unless it holds the same already.
      const commit = Effect.fnUntraced(function* ([, hash]: Placed) {
        if (pending !== null && placed.length === 1) {
          if (!(single && ranges[0]?.placed[1] === hash)) {
            yield* put(object, { text: pending.text, hash })
          }

          return
        }

        if (same()) return

        const text = JSON.stringify(Index.make({ packs: placed }))

        yield* put(object, { text, hash: yield* fingerprint(text) })
      })

      // Closes the last range, stores the entry's object, then removes the
      // packs it no longer lists.
      const finish = Effect.gen(function* () {
        if (Option.isNone(last)) return

        yield* enter(ranges.length)

        const [first] = placed

        if (first === undefined) return

        yield* commit(first)
        committed = true

        const listed = new Set(placed.map(([, hash]) => hash))
        const gone = [...indexed].filter((hash) => !listed.has(hash))

        for (const chunk of Arr.chunksOf(gone, 1000)) {
          yield* attempt(() => bucket.delete(chunk.map((hash) => packOf(indicator, hash))))
        }
      })

      // Removes the packs a failed write stored before its index.
      const discard = Effect.suspend(() =>
        committed || !Arr.isArrayNonEmpty(written)
          ? Effect.void
          : attempt(() => bucket.delete(written.map((hash) => packOf(indicator, hash)))),
      ).pipe(Effect.ignore)

      return { offer, finish, discard }
    }

    return Store.of({ read, write, namespace })
  }

  // Outside Workers nothing is stored, so every chart asks its source.
  private static readonly empty: Interface = Store.of({
    namespace: () => Store.empty,
    read: () => Effect.succeedNone,
    write: () => Stream.fail(new StoreUnavailable({ cause: "No SERIES bucket" })),
  })

  static readonly none = Layer.succeed(Store, Store.empty)

  // The SERIES bucket inside Workers (deployed, or under `alchemy dev`).
  static readonly layer = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) => (env.SERIES === undefined ? Store.none : Store.r2(env.SERIES))),
      Effect.orElseSucceed(() => Store.none),
    ),
  )
}
