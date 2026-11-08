import { http, HttpResponse } from "msw/http"
import { setupServer } from "msw/node"

const unhandled: Array<string> = []

// Last in line: answers any request no test handler matched with a network
// error, and records it so the test that sent it fails in setup.ts.
const fallback = http.all("*", ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`)

  return HttpResponse.error()
})

// The fake network every frontend test runs against. Register a test's
// responses with `network.use(...)` handlers from `msw/http`.
export const network = setupServer(fallback)

export const drainUnhandled = () => unhandled.splice(0)
