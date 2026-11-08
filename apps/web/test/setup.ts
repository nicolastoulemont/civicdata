import { cleanup } from "@testing-library/react"
import { afterAll, afterEach, beforeAll } from "vitest"

import { drainUnhandled, network } from "./network.ts"

// HTTP requests fall through to the recording fallback in network.ts; this
// catches anything else, such as WebSocket connections.
beforeAll(() => network.listen({ onUnhandledFrame: "error" }))

afterEach(() => {
  cleanup()
  network.resetHandlers()

  const unhandled = drainUnhandled()

  if (unhandled.length > 0) {
    throw new Error(`Requests without an MSW handler:\n${unhandled.join("\n")}`)
  }
})

afterAll(() => network.close())
