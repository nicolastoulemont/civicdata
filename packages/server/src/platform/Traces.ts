import { Locale } from "@repo/domain"
import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Scope,
  Tracer,
} from "effect"
import {
  FetchHttpClient,
  type HttpClient,
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http"
import { OtlpProxy, OtlpSerialization, OtlpTracer } from "effect/observability"

import { path } from "./constants/path.ts"
import type { ServeOptions } from "./Traces.types.ts"
import { settled } from "./utils/settled.ts"

// Spans go to one OTLP endpoint: Grafana Cloud on deployed stages, a local
// Grafana in `pnpm dev`, nowhere when the stage has none (docs/traces.md).
// Only traces are exported. Effect writes each log inside a span as an event
// of that span, so the warnings travel with the trace that raised them.

// Only the supported UI locale is recorded, never arbitrary header text.
const decodeLocale = Schema.decodeUnknownOption(Locale)

export const locale = HttpRouter.middleware(
  (handler) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const found = decodeLocale(request.headers["x-user-locale"])

      if (Option.isSome(found)) yield* Effect.annotateCurrentSpan("openfacts.locale", found.value)

      return yield* handler
    }),
  { global: true },
)

// The OTLP endpoint and the headers it needs, in the form Grafana Cloud's
// OTLP page prints them: `Authorization=Basic%20...`.
const Destination = Config.all({
  endpoint: Config.String("OTEL_EXPORTER_OTLP_ENDPOINT"),
  headers: Config.Record(
    Schema.String,
    Schema.StringFromUriComponent,
    "OTEL_EXPORTER_OTLP_HEADERS",
  ).pipe(Config.withDefault({})),
})

// Which deployment sent a span: its Alchemy stage and the commit it runs.
const Deployment = Config.all({
  stage: Config.String("STAGE").pipe(Config.withDefault("local")),
  version: Config.option(Config.String("VERSION")),
})

const Settings = Config.all({ destination: Destination, deployment: Deployment })

// Where this deployment sends spans, if anywhere: the Worker's bindings, else
// the environment (`pnpm dev:web`, tests). A malformed setting turns tracing
// off rather than the app.
const destination = Effect.gen(function* () {
  const ambient = yield* ConfigProvider.ConfigProvider

  const bound = yield* Effect.tryPromise(() => import("cloudflare:workers")).pipe(
    Effect.map(({ env }) => ConfigProvider.orElse(ConfigProvider.fromUnknown(env), ambient)),
    Effect.orElseSucceed(() => ambient),
  )

  return yield* Config.option(Settings).parse(bound)
}).pipe(
  Effect.tapError((error) =>
    Effect.logWarning("Tracing is off: its settings are malformed", error),
  ),
  Effect.orElseSucceed(() => Option.none<Config.Success<typeof Settings>>()),
)

const url = (endpoint: string) => `${endpoint.replace(/\/$/, "")}/v1/traces`

// The tracer in context, settled.
const settling = Layer.effect(Tracer.Tracer, Effect.map(Effect.service(Tracer.Tracer), settled))

// The server's spans exported to the destination, or recorded nowhere. Closing
// its scope exports what is left.
export const layer: Layer.Layer<never> = Layer.unwrap(
  Effect.map(
    destination,
    Option.match({
      onNone: () => Layer.empty,
      onSome: ({ destination: { endpoint, headers }, deployment: { stage, version } }) =>
        OtlpTracer.layer({
          url: url(endpoint),
          headers,
          resource: {
            serviceName: "openfacts-server",
            serviceVersion: Option.getOrUndefined(version),
            attributes: { "deployment.environment.name": stage },
          },
        }).pipe(
          Layer.provide(OtlpSerialization.layerProtobuf),
          Layer.provide(FetchHttpClient.layer),
          (exporting) => Layer.provide(settling, exporting),
        ),
    }),
  ),
)

// Outside Workers nothing needs keeping alive after a response.
const unkept: (promise: Promise<unknown>) => void = () => {}

type Handler = (request: Request, context?: Context.Context<never>) => Promise<Response>

// Serves each request with a tracer of its own, closed once the response's
// body ends, which exports the request's spans after the response through
// waitUntil. Workers throw when a fiber started in one request resumes in
// another, and a tracer shared across requests keeps such a fiber: its export
// loop, which the next request's first span would wake. The spans an answer
// makes after its reader left go nowhere.
export const serve =
  (handler: Handler, { tracer = layer }: ServeOptions = {}) =>
  async (request: Request): Promise<Response> => {
    const scope = Scope.makeUnsafe()
    const close = () => Effect.runPromise(Scope.close(scope, Exit.void))

    const { waitUntil } = await import("cloudflare:workers").catch(() => ({ waitUntil: unkept }))

    const response = await Effect.runPromise(Layer.buildWithScope(tracer, scope)).then((context) =>
      handler(request, context),
    )

    if (response.body === null) {
      waitUntil(close())

      return response
    }

    const { readable, writable } = new TransformStream()

    waitUntil(response.body.pipeTo(writable).then(close, close))

    return new Response(readable, response)
  }

interface Limit {
  // Whether a visitor may send one more batch of spans.
  readonly allows: (visitor: string) => Effect.Effect<boolean>
}

// Every batch the browser sends spends the destination's quota, so a
// deployment caps how often one visitor sends one. The cap itself lives in
// the TRACE_LIMIT binding's configuration.
export class TraceLimit extends Context.Service<TraceLimit, Limit>()(
  "@repo/server/Traces/TraceLimit",
) {
  static readonly none = Layer.succeed(
    TraceLimit,
    TraceLimit.of({ allows: () => Effect.succeed(true) }),
  )

  // The Workers rate limit binding, when the deployment has one. A failing
  // limiter lets the batch through.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) => {
        const limiter = env.TRACE_LIMIT

        return limiter === undefined
          ? TraceLimit.none
          : Layer.succeed(
              TraceLimit,
              TraceLimit.of({
                allows: (visitor) =>
                  Effect.tryPromise(() => limiter.limit({ key: visitor })).pipe(
                    Effect.map(({ success }) => success),
                    Effect.orElseSucceed(() => true),
                  ),
              }),
            )
      }),
      Effect.orElseSucceed(() => TraceLimit.none),
    ),
  )
}

// Accepts a batch of spans the browser sends and passes it on with the
// destination's headers, up to 64 KiB, a browser's keepalive limit. A visitor
// over TraceLimit gets 429, which the browser's exporter backs off from. With
// no destination it accepts every batch and drops it, so the browser needs
// to know nothing about the deployment. Requests to it make no spans.
export const proxy: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | HttpClient.HttpClient | TraceLimit
> = Layer.unwrap(
  Effect.gen(function* () {
    const found = yield* destination

    if (Option.isNone(found)) {
      return HttpRouter.add("POST", path, HttpServerResponse.empty({ status: 204 }))
    }

    const { endpoint, headers } = found.value.destination
    const limit = yield* TraceLimit

    const { traces } = yield* OtlpProxy.make({
      baseUrl: endpoint,
      urls: { traces: url(endpoint) },
      headers,
      maxBodySize: "64 KiB",
    })

    return HttpRouter.add("POST", path, (request) =>
      limit
        .allows(request.headers["cf-connecting-ip"] ?? "unknown")
        .pipe(
          Effect.flatMap((allowed) =>
            allowed ? traces : Effect.succeed(HttpServerResponse.empty({ status: 429 })),
          ),
        ),
    )
  }),
).pipe(Layer.provide(HttpMiddleware.layerTracerDisabledForUrls([path])))
