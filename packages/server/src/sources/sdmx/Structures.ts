import { SourceUnavailable } from "@repo/domain"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Gunzip } from "fflate"

import type { Discovery } from "../../series/Adapter.ts"
import {
  type Codelist,
  Constraints,
  constraints,
  DataStructures,
  EurostatCodelists,
  eurostatLabels,
  type Labels,
  metabase,
  OecdCodelists,
  oecdLabels,
  type Outline,
  Outlines,
} from "../../series/Outlines.ts"
import { eurostat, oecd, type SdmxSource } from "./SdmxSource.ts"

const structure = "application/vnd.sdmx.structure+json;version=1.0"

// Eurostat's codelists in JSON-stat, in English.
const eurostatCodelists = (id: string) =>
  `${eurostat}/sdmx/2.1/codelist/ESTAT/${id}/latest?format=JSON&lang=en`

// Logs why reading failed, and fails as the source being unavailable.
const unavailable =
  (source: SdmxSource, what: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapError((error) => Effect.logWarning(`Reading ${what} failed`, source, error)),
      Effect.mapError(() => new SourceUnavailable({ source })),
    )

// A zipped body, unzipped as it streams. Eurostat sends the metabase
// as a file, not a zipped answer, so fetch leaves it zipped.
const unzipped = (response: HttpClientResponse.HttpClientResponse) =>
  response.stream.pipe(
    Stream.mapAccum(
      () => {
        const out: Array<Uint8Array> = []

        return { gunzip: new Gunzip((chunk) => out.push(chunk)), out }
      },
      (state, chunk) => {
        state.gunzip.push(chunk)

        return [state, state.out.splice(0)]
      },
      {
        onHalt: (state) => {
          state.gunzip.push(new Uint8Array(0), true)

          return state.out.splice(0)
        },
      },
    ),
  )

interface Interface {
  // The outline of each of the source's datasets, from the files a Worker can
  // read: Eurostat's metabase (4 MB zipped, read as it streams), and the
  // OECD's content constraints (7 MB) and data structures (2 MB), one request
  // each.
  readonly outlines: (source: SdmxSource) => Stream.Stream<Outline, SourceUnavailable>
  // The labels of one codelist's codes, or none when the source has no such
  // codelist.
  readonly codelist: (
    source: SdmxSource,
    codelist: Codelist,
  ) => Effect.Effect<ReadonlyMap<string, string>, SourceUnavailable>
  // The labels of every codelist the source publishes, in one file: 58 MB
  // for Eurostat, 33 MB for the OECD. Decoded, either outgrows a Worker's
  // 128 MB, so only the first fill reads them (scripts/outlines.ts).
  readonly labels: (source: SdmxSource) => Effect.Effect<Labels, SourceUnavailable>
}

// What Eurostat and the OECD publish about the structure of all their
// datasets, read over HTTP.
export class Structures extends Context.Service<Structures, Interface>()(
  "@repo/server/Structures",
) {
  static readonly layer = Layer.effect(
    Structures,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      // An answer other than 200 is the source being unavailable; one of
      // `missing` is an answer of its own.
      const ask = Effect.fnUntraced(function* (
        source: SdmxSource,
        { url, missing = [] }: { url: string; missing?: ReadonlyArray<number> },
      ) {
        const response = yield* client.execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeaders(
              source === "OECD"
                ? { accept: structure, "accept-language": "en" }
                : { accept: "*/*", "accept-language": "en" },
            ),
          ),
        )

        if (response.status === 200 || missing.includes(response.status)) return response

        const body = yield* response.text

        return yield* Effect.fail(`${url} answered ${response.status}: ${body.slice(0, 300)}`)
      })

      // The answer's JSON, decoded.
      const decoded = <A, I>(
        source: SdmxSource,
        { url, schema }: { url: string; schema: Schema.Codec<A, I> },
      ) => ask(source, { url }).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)))

      const outlines = (source: SdmxSource): Stream.Stream<Outline, SourceUnavailable> =>
        source === "Eurostat"
          ? Stream.unwrap(
              ask(source, { url: `${eurostat}/catalogue/metabase.txt.gz` }).pipe(
                Effect.map((response) =>
                  unzipped(response).pipe(Stream.decodeText, Stream.splitLines, metabase),
                ),
              ),
            ).pipe(
              Stream.tapError((error) => Effect.logWarning("Reading the metabase failed", error)),
              Stream.mapError(() => new SourceUnavailable({ source })),
            )
          : Stream.fromIterableEffect(
              Effect.gen(function* () {
                const found = yield* decoded(source, {
                  url: `${oecd}/contentconstraint/all/all/latest`,
                  schema: Constraints,
                })

                const structures = yield* decoded(source, {
                  url: `${oecd}/datastructure/all/all/latest?detail=full&references=none`,
                  schema: DataStructures,
                })

                return constraints({ constraints: found, structures })
              }).pipe(unavailable(source, "the constraints")),
            )

      const codelist = Effect.fn("Structures.codelist")(function* (
        source: SdmxSource,
        key: Codelist,
      ) {
        const [agency = "", id = ""] = key.split(":")

        const url =
          source === "Eurostat" ? eurostatCodelists(id) : `${oecd}/codelist/${agency}/${id}/latest`

        return yield* ask(source, { url, missing: [404] }).pipe(
          Effect.flatMap((response) =>
            response.status === 404
              ? Effect.succeed(new Map<string, string>())
              : (source === "Eurostat"
                  ? HttpClientResponse.schemaBodyJson(EurostatCodelists)(response).pipe(
                      Effect.map(eurostatLabels),
                    )
                  : HttpClientResponse.schemaBodyJson(OecdCodelists)(response).pipe(
                      Effect.map(oecdLabels),
                    )
                ).pipe(Effect.map((labels) => labels.get(key) ?? new Map<string, string>())),
          ),
          unavailable(source, `the codelist ${key}`),
        )
      })

      const labels = Effect.fn("Structures.labels")(function* (source: SdmxSource) {
        return yield* (
          source === "Eurostat"
            ? decoded(source, { url: eurostatCodelists("all"), schema: EurostatCodelists }).pipe(
                Effect.map(eurostatLabels),
              )
            : decoded(source, {
                url: `${oecd}/codelist/all/all/latest`,
                schema: OecdCodelists,
              }).pipe(Effect.map(oecdLabels))
        ).pipe(unavailable(source, "every codelist"))
      })

      return Structures.of({ outlines, codelist, labels })
    }),
  )
}

// A stage's first fill of one source's outlines and labels: what a build
// stores, with every label read from the source's bulk file instead of one
// request per codelist. The OECD's 50 requests an hour would take weeks of
// builds to label its 1,500 dataflows. Runs outside Workers, where the bulk
// files fit (scripts/outlines.ts). Answers how many outlines, labels and texts it
// wrote.
export const fill = Effect.fn("Structures.fill")(function* (source: SdmxSource) {
  const structures = yield* Structures
  const outlines = yield* Outlines

  const outlined = yield* outlines.write(source, structures.outlines(source))
  const labels = yield* structures.labels(source)
  const unlabelled = yield* outlines.unlabelled(source, { after: "", limit: 100_000 })

  const labelled = yield* Effect.forEach(
    unlabelled,
    (codelist) => outlines.label(source, { codelist, labels: labels.get(codelist) ?? new Map() }),
    { concurrency: 8 },
  )

  return {
    outlines: outlined,
    labels: labelled.reduce((sum, count) => sum + count, 0),
    texts: yield* outlines.describe(source),
  }
})

// SDMX adapters keep their own request limits; orchestration only sees a capability.
export const discovery = (structures: Interface, source: SdmxSource): Discovery => ({
  outlines: structures.outlines(source),
  codelists: {
    perStep: source === "Eurostat" ? 25 : 10,
    steps: source === "Eurostat" ? Number.POSITIVE_INFINITY : 1,
    labels: (key) => structures.codelist(source, key),
  },
})
