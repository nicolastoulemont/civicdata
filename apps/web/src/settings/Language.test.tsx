import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { OtlpExporter } from "effect/observability"
import { http, HttpResponse } from "msw"
import { renderToString } from "react-dom/server"
import { useTranslation } from "react-i18next"
import { afterEach, expect, it, vi } from "vitest"

import { network } from "../../test/network.ts"
import { call } from "../api.ts"
import { createI18n, LocaleProvider, matchLocale } from "../locale.tsx"
import { traced } from "../traces.ts"
import { Language } from "./Language.tsx"

const Current = () => {
  const { i18n } = useTranslation()

  return <output aria-label="Current locale">{i18n.language}</output>
}

const send = () => call({ baseUrl: undefined, layer: FetchHttpClient.layer }, (api) => api.health())

const show = () => {
  const instance = createI18n()

  render(
    <LocaleProvider instance={instance}>
      <Language />
      <Current />
    </LocaleProvider>,
  )

  return instance
}

afterEach(() => vi.restoreAllMocks())

it("uses the browser language, saves an explicit choice, and keeps the URL", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-AT", "en-US"])
  const url = window.location.href
  show()

  expect(screen.getByLabelText("Current locale").textContent).toBe("de-DE")
  await userEvent.click(screen.getByRole("combobox"))
  await userEvent.click(await screen.findByRole("option", { name: "Français" }))

  expect(await screen.findByRole("combobox", { name: "Langue" })).toBeDefined()
  expect(localStorage.getItem("i18nextLng")).toBe("fr-FR")
  expect(window.location.href).toBe(url)

  cleanup()
  show()
  expect(await screen.findByRole("combobox", { name: "Langue" })).toBeDefined()
})

it("sends the chosen locale on API requests and updates it after a change", async () => {
  localStorage.setItem("i18nextLng", "pt-PT")
  const received: Array<string | null> = []
  network.use(
    http.get("/api/health", ({ request }) => {
      received.push(request.headers.get("X-User-Locale"))

      return new HttpResponse(null, { status: 204 })
    }),
  )
  show()

  await send()
  await userEvent.click(screen.getByRole("combobox"))
  await userEvent.click(await screen.findByRole("option", { name: "Português (Brasil)" }))
  await send()

  expect(received).toEqual(["pt-PT", "pt-BR"])
})

it("uses en-US when the saved choice and browser languages are unsupported", () => {
  localStorage.setItem("i18nextLng", "<script>")
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP"])
  show()

  expect(screen.getByLabelText("Current locale").textContent).toBe("en-US")
})

it("changes language even when the browser blocks storage", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError")
  })
  show()
  await userEvent.click(screen.getByRole("combobox"))
  await userEvent.click(await screen.findByRole("option", { name: "Français" }))

  expect(await screen.findByRole("combobox", { name: "Langue" })).toBeDefined()
})

it("keeps server renders isolated in en-US even when the browser has another choice", async () => {
  localStorage.setItem("i18nextLng", "fr-FR")
  const client = show()
  await waitFor(() => expect(client.language).toBe("fr-FR"))
  const first = createI18n()
  const second = createI18n()

  const html = renderToString(
    <LocaleProvider instance={second}>
      <Current />
    </LocaleProvider>,
  )

  expect(html).toContain("en-US")
  expect(first.language).toBe("en-US")
})

it.each([
  [["pt-PT"], "pt-PT"],
  [["pt"], "pt-BR"],
  [["zh-Hans-SG"], "zh-CN"],
  [["es-MX"], "es-ES"],
  [["ja-JP", "it-CH"], "it-IT"],
  [[], "en-US"],
] as const)("matches %j to %s", (preferences, expected) => {
  expect(matchLocale(preferences)).toBe(expected)
})

it("hydrates English markup before activating the saved browser locale", async () => {
  localStorage.setItem("i18nextLng", "fr-FR")
  const container = document.createElement("div")
  const recovered: Array<unknown> = []

  container.innerHTML = renderToString(
    <LocaleProvider instance={createI18n()}>
      <Current />
    </LocaleProvider>,
  )
  document.body.append(container)

  expect(container.textContent).toBe("en-US")
  render(
    <LocaleProvider instance={createI18n()}>
      <Current />
    </LocaleProvider>,
    {
      container,
      hydrate: true,
      onRecoverableError: (error) => recovered.push(error),
    },
  )

  await waitFor(() => expect(screen.getByLabelText("Current locale").textContent).toBe("fr-FR"))
  expect(recovered).toEqual([])
})

it("includes the selected locale on browser trace batches", async () => {
  localStorage.setItem("i18nextLng", "pt-PT")
  const locales: Array<string | null> = []

  network.use(
    http.post("/api/otlp/v1/traces", ({ request }) => {
      locales.push(request.headers.get("X-User-Locale"))

      return new HttpResponse(null, { status: 200 })
    }),
  )
  show()
  await traced().runPromise(Effect.void.pipe(Effect.withSpan("locale.test")))
  await traced().runPromise(Effect.flatMap(OtlpExporter.Flusher, (flusher) => flusher.flush))

  expect(locales).toEqual(["pt-PT"])
})
