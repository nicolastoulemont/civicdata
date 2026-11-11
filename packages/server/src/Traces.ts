import { Config, ConfigProvider, Context, Effect, Layer, Option, Schema } from "effect"
import {
  FetchHttpClient,
  type HttpClient,
  HttpMiddleware,
  HttpRouter,
  HttpServerResponse,
} from "effect/http"
import { OtlpExporter, OtlpProxy, OtlpSerialization, OtlpTracer } from "effect/observability"

// Spans go to one OTLP endpoint: Grafana Cloud on deployed stages, a local
// Grafana in `pnpm dev`, nowhere when the stage has none (docs/traces.md).
// Only traces are exported. Effect writes each log inside a span as an event
// of that span, so the warnings travel with the trace that raised them.

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

// The server's spans exported to the destination, or recorded nowhere. The
// Flusher exports what is buffered; see `settle`.
export const layer: Layer.Layer<OtlpExporter.Flusher> = Layer.unwrap(
  Effect.map(
    destination,
    Option.match({
      onNone: () => OtlpExporter.layerFlusher,
      onSome: ({ destination: { endpoint, headers }, deployment: { stage, version } }) =>
        OtlpTracer.layer({
          url: url(endpoint),
          headers,
          resource: {
            serviceName: "civicdata-server",
            serviceVersion: Option.getOrUndefined(version),
            attributes: { "deployment.environment.name": stage },
          },
        }).pipe(
          Layer.provide(OtlpSerialization.layerProtobuf),
          Layer.provide(FetchHttpClient.layer),
        ),
    }),
  ),
)

// Outside Workers nothing needs keeping alive after a response.
const unkept: (promise: Promise<unknown>) => void = () => {}

// Workers may freeze an isolate once it has answered, with spans still
// buffered. Hands their export to waitUntil, so it finishes after the
// response; outside Workers the process lives on and exports them anyway.
export const settle = Effect.gen(function* () {
  const flusher = yield* OtlpExporter.Flusher

  const later = yield* Effect.tryPromise(() => import("cloudflare:workers")).pipe(
    Effect.map(({ waitUntil }) => waitUntil),
    Effect.orElseSucceed(() => unkept),
  )

  later(Effect.runPromise(flusher.flush))
})

interface Limit {
  // Whether a visitor may send one more batch of spans.
  readonly allows: (visitor: string) => Effect.Effect<boolean>
}

// Every batch the browser sends spends the destination's quota, so a
// deployment caps how often one visitor sends one. The cap itself lives in
// the TRACE_LIMIT binding's configuration.
export class TraceLimit extends Context.Service<TraceLimit, Limit>()(
  "@civicdata/server/Traces/TraceLimit",
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

// Where the browser sends its spans: this origin, so the vendor's key stays
// on the server (apps/web/src/traces.ts).
export const path = "/api/otlp/v1/traces"

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
