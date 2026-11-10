import { cleanup } from "@testing-library/react"
import { afterAll, afterEach, beforeAll } from "vitest"

import { drainUnhandled, network } from "./network.ts"

// HTTP requests fall through to the recording fallback in network.ts; this
// catches anything else, such as WebSocket connections.
beforeAll(() => network.listen({ onUnhandledFrame: "error" }))

afterEach(() => {
  cleanup()

  // Drafts, history and settings live in localStorage, which the tests that
  // run in Node do not have.
  if (typeof localStorage !== "undefined") localStorage.clear()
  network.resetHandlers()

  const unhandled = drainUnhandled()

  if (unhandled.length > 0) {
    throw new Error(`Requests without an MSW handler:\n${unhandled.join("\n")}`)
  }
})

afterAll(() => network.close())
