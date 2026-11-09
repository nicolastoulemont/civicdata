// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./cloudflare.d.ts" />

import { type CatalogEntry, IndicatorId } from "@civicdata/domain"
import { Array as Arr, Context, Effect, Layer, Schema } from "effect"

const Embedded = Schema.Struct({ data: Schema.NonEmptyArray(Schema.Array(Schema.Finite)) })

const Matches = Schema.Struct({
  matches: Schema.Array(Schema.Struct({ id: IndicatorId, score: Schema.Finite })),
})

// What the index needs from the Workers AI binding. Its answers are decoded
// before use: the types say what Workers AI documents, not what it sent.
export interface Ai {
  readonly run: (
    name: typeof model,
    input: {
      readonly text: ReadonlyArray<string>
      readonly pooling: "cls"
      readonly truncate_inputs: true
    },
  ) => Promise<{ readonly data: ReadonlyArray<ReadonlyArray<number>> }>
}

// What the index needs from a Vectorize index binding.
export interface Index {
  readonly upsert: (
    vectors: Array<{ readonly id: string; readonly values: ReadonlyArray<number> }>,
  ) => Promise<{ readonly mutationId: string }>
  readonly query: (
    vector: ReadonlyArray<number>,
    options: { readonly topK: number },
  ) => Promise<{
    readonly matches: ReadonlyArray<{ readonly id: string; readonly score: number }>
  }>
}

// Workers AI or Vectorize failed, or answered in a shape we do not recognize.
class VectorsUnavailable extends Schema.TaggedError<
  VectorsUnavailable,
  { readonly brand: unique symbol }
>()("VectorsUnavailable", { cause: Schema.Unknown }) {}

interface Interface {
  // Stores the meaning of each entry, replacing what an earlier put stored.
  readonly put: (entries: ReadonlyArray<CatalogEntry>) => Effect.Effect<void, VectorsUnavailable>
  // The indicators closest in meaning to the text, closest first.
  readonly nearest: (text: string) => Effect.Effect<ReadonlyArray<IndicatorId>, VectorsUnavailable>
}

// 384 dimensions: the smallest BGE model. On the World Bank catalog, bge-base
// ranked no better and costs twice the Vectorize quota. The index in
// packages/infra is made for this model: changing it replaces the index,
// which fills again only from the next weekly catalog refresh.
const model = "@cf/baai/bge-small-en-v1.5"

// BGE's instruction for a short query matched against longer passages.
const instruction = "Represent this sentence for searching relevant passages: "

// Cosine similarity below which a neighbor is noise. On the World Bank
// catalog, text with no meaning ("xq", "SP.POP") tops out near 0.57, and
// questions such as "kids dying young" find their indicators above 0.65.
const minimumScore = 0.58

const topK = 20

// Vectorize ids are at most 64 bytes. World Bank codes are far shorter.
const fitsAnId = (entry: CatalogEntry) => entry.indicator.length <= 64

const call = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new VectorsUnavailable({ cause }) })

// Workers AI and Vectorize answers cross a trust boundary like any HTTP body.
const decode =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  <A, E>(self: Effect.Effect<A, E>) =>
    self.pipe(
      Effect.flatMap((body) =>
        Schema.decodeUnknownEffect(schema)(body).pipe(
          Effect.mapError((cause) => new VectorsUnavailable({ cause })),
        ),
      ),
    )

// Indicator meaning, embedded by Workers AI and searched in Vectorize.
// Searches run while the catalog loads, so callers treat a failure as "no
// neighbors" rather than failing the search.
export class Vectors extends Context.Service<Vectors, Interface>()("@civicdata/server/Vectors") {
  static readonly cloudflare = ({ ai, index }: { ai: Ai; index: Index }) => {
    const embed = Effect.fnUntraced(function* (text: Arr.NonEmptyReadonlyArray<string>) {
      const { data } = yield* call(() =>
        ai.run(model, { text, pooling: "cls", truncate_inputs: true }),
      ).pipe(decode(Embedded))

      if (data.length !== text.length) {
        return yield* new VectorsUnavailable({
          cause: `Workers AI embedded ${data.length} of ${text.length} texts`,
        })
      }

      return data
    })

    const put = Effect.fn("Vectors.put")(function* (entries: ReadonlyArray<CatalogEntry>) {
      const indexed = entries.filter(fitsAnId)

      if (!Arr.isReadonlyArrayNonEmpty(indexed)) return

      const vectors = yield* embed(
        Arr.map(indexed, ({ name, definition }) => `${name}\n${definition}`),
      )

      yield* call(() =>
        index.upsert(
          Arr.zipWith(indexed, vectors, ({ indicator }, values) => ({ id: indicator, values })),
        ),
      )
    })

    const nearest = Effect.fn("Vectors.nearest")(function* (text: string) {
      const vector = Arr.headNonEmpty(yield* embed([instruction + text]))
      const { matches } = yield* call(() => index.query(vector, { topK })).pipe(decode(Matches))

      return matches.filter(({ score }) => score >= minimumScore).map(({ id }) => id)
    })

    return Layer.succeed(Vectors, Vectors.of({ put, nearest }))
  }

  static readonly none = Layer.succeed(
    Vectors,
    Vectors.of({ put: () => Effect.void, nearest: () => Effect.succeed([]) }),
  )

  // Workers AI and Vectorize inside Workers (deployed, or under `alchemy
  // dev`, which proxies both to Cloudflare). Plain `pnpm dev` runs in Node,
  // where `cloudflare:workers` does not exist.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.AI === undefined || env.VECTORS === undefined
          ? Vectors.none
          : Vectors.cloudflare({ ai: env.AI, index: env.VECTORS }),
      ),
      Effect.orElseSucceed(() => Vectors.none),
    ),
  )
}
