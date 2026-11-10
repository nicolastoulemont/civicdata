import { Source } from "@civicdata/domain"
import { env } from "cloudflare:workers"
import { DateTime, Effect, Layer, Option, Result, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
  Url,
} from "effect/http"

import { Cache } from "../src/Cache.ts"
import { hosts, Pace } from "../src/Pace.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { Tally } from "./Tally.ts"

// One answer a source gave the eval: what was asked, when, and what came back.
const Recording = Schema.Struct({
  source: Source,
  url: Schema.String,
  accept: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
  status: Schema.Int,
  contentType: Schema.String,
  body: Schema.String,
})

const RecordingJson = Schema.fromJsonString(Schema.toCodecJson(Recording))

// A source's answer to keep: anything but a refusal or a server error, which
// say nothing about the data.
const kept = (status: number) => status < 500 && status !== 429

const folders: Record<Source, string> = {
  OECD: "oecd",
  Eurostat: "eurostat",
  "World Bank": "world-bank",
}

// Where the answer to `url`, asked in `accept`, is kept: a file per request,
// named by a hash of both, under the source's folder.
const pathOf = Effect.fnUntraced(function* (
  source: Source,
  { url, accept }: { url: string; accept: string },
) {
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${accept}\n${url}`)),
  )

  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")

  return `https://recordings/${folders[source]}/${hex}.json`
})

// The files under eval/recordings, through the RECORDINGS binding that
// vitest.eval.config.ts serves from Node. The eval cannot run without it.
const store = Effect.sync(() => {
  const binding = env.RECORDINGS

  if (binding === undefined) throw new Error("The eval needs the RECORDINGS binding")

  return {
    find: (path: string) =>
      Effect.promise(async () => {
        const response = await binding.fetch(new Request(path))

        return response.status === 404 ? Option.none() : Option.some(await response.text())
      }),
    keep: (path: string, text: string) =>
      Effect.promise(() => binding.fetch(new Request(path, { method: "PUT", body: text }))),
  }
})

// Answers a request to a source from its recording. A request without one
// goes on to the source, and its answer is recorded for the next run, so a
// run asks a source only what no earlier run did.
const recorded = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const tally = yield* Tally
    const { find, keep } = yield* store

    const replay = Effect.fnUntraced(function* (
      send: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
      request: HttpClientRequest.HttpClientRequest,
    ) {
      const url = Url.make(request.url, request.urlParams, Option.getOrUndefined(request.hash))
      const source = Result.isSuccess(url) ? hosts.get(url.success.host) : undefined

      if (Result.isFailure(url) || source === undefined) return yield* send

      const asked = { url: url.success.href, accept: request.headers["accept"] ?? "" }
      const path = yield* pathOf(source, asked)
      const found = yield* find(path)

      const answer = (recording: typeof Recording.Type) =>
        HttpClientResponse.fromWeb(
          request,
          new Response(recording.body, {
            status: recording.status,
            headers: { "content-type": recording.contentType },
          }),
        )

      if (Option.isSome(found)) {
        const recording = yield* Schema.decodeEffect(RecordingJson)(found.value).pipe(
          Effect.mapError((error) => new Error(`${path} is not a recording: ${error.message}`)),
          Effect.orDie,
        )

        yield* tally.replayed(source)

        return answer(recording)
      }

      const response = yield* send

      if (!kept(response.status)) return response

      const recording = {
        source,
        ...asked,
        retrievedAt: yield* DateTime.now,
        status: response.status,
        contentType: response.headers["content-type"] ?? "",
        body: yield* response.text,
      }

      yield* keep(path, yield* Schema.encodeEffect(RecordingJson)(recording).pipe(Effect.orDie))

      return answer(recording)
    })

    return HttpClient.transform(client, replay)
  }),
)

// Counts the requests that leave the machine: those the pacer sends on. A
// request hook would also count those it refuses, since hooks run first.
const counted = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const tally = yield* Tally

    return HttpClient.transform(client, (send, request) => {
      const source = hosts.get(new URL(request.url).host)

      return source === undefined ? send : Effect.andThen(tally.sent(source), send)
    })
  }),
).pipe(Layer.provide(FetchHttpClient.layer))

// The World Bank and SDMX adapters as deployed, cached and paced, with each
// source's answers replayed from eval/recordings above the pacer: a replayed
// answer spends none of a source's request budget.
export const Sources = Layer.merge(Sdmx.cached, WorldBank.cached).pipe(
  Layer.provide(recorded),
  Layer.provide(Pace.client),
  Layer.provide(counted),
  Layer.provide(Pace.live),
  Layer.provide(Cache.layer),
)
