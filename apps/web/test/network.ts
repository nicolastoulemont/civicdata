import { Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { setupServer } from "msw/node"

const unhandled: Array<string> = []

// Last in line: answers any request no test handler matched with a network
// error, and records it so the test that sent it fails in setup.ts.
const fallback = http.all("*", ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`)

  return HttpResponse.error()
})

// A batch of spans as the page exports it: OTLP's JSON form, keeping what
// tests read.
const Batch = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      scopeSpans: Schema.Array(
        Schema.Struct({
          spans: Schema.Array(
            Schema.Struct({
              traceId: Schema.String,
              spanId: Schema.String,
              name: Schema.String,
              attributes: Schema.Array(
                Schema.Struct({
                  key: Schema.String,
                  value: Schema.Struct({ stringValue: Schema.optionalKey(Schema.String) }),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
})

// A span the page exported, with its string attributes.
export interface Exported {
  readonly traceId: string
  readonly name: string
  readonly attributes: Readonly<Record<string, string | undefined>>
}

const exported: Array<Exported> = []

// The Worker's trace proxy, which keeps every span the page exports.
const traces = http.post("/api/otlp/v1/traces", async ({ request }) => {
  const batch = Schema.decodeUnknownSync(Batch)(await request.json())

  exported.push(
    ...batch.resourceSpans.flatMap(({ scopeSpans }) =>
      scopeSpans.flatMap(({ spans }) =>
        spans.map(({ traceId, name, attributes }) => ({
          traceId,
          name,
          attributes: Object.fromEntries(
            attributes.map(({ key, value }) => [key, value.stringValue]),
          ),
        })),
      ),
    ),
  )

  return new HttpResponse(null, { status: 200 })
})

// The spans the page exported so far, in every test of the file.
export const exportedSpans = (): ReadonlyArray<Exported> => exported

// The Worker's check, which the app runs once it loads. A browser in a test
// holds a pass.
const verification = http.post("/api/verification", () => new HttpResponse(null, { status: 204 }))

// The fake network every frontend test runs against. Register a test's
// responses with `network.use(...)` handlers from `msw/http`.
export const network = setupServer(traces, verification, fallback)

export const drainUnhandled = () => unhandled.splice(0)
