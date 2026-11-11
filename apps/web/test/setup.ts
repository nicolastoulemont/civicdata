import { cleanup } from "@testing-library/react"
import { setI18n } from "react-i18next"
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest"

import { createI18n } from "../src/locale.tsx"
import { drainUnhandled, network } from "./network.ts"

beforeEach(() => setI18n(createI18n()))

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
