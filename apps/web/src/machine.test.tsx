import { Machine } from "@openfacts/machine"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Data, Effect } from "effect"
import { http, HttpResponse } from "msw/http"
import { expect, it, vi } from "vitest"

import { network } from "../test/network.ts"
import { useMachine } from "./machine.ts"

// Looks up a country's name by its code, and hands back each name it shows.
type Lookup = Data.TaggedEnum<{
  Idle: { readonly code: string }
  Looking: { readonly code: string }
  Named: { readonly code: string; readonly name: string }
  Failed: { readonly code: string }
}>

const Lookup = Data.taggedEnum<Lookup>()

type LookupEvent = Data.TaggedEnum<{
  Look: {}
  Found: { readonly name: string }
  Missed: {}
}>

const LookupEvent = Data.taggedEnum<LookupEvent>()

const nameOf = (code: string) =>
  Effect.tryPromise((signal) =>
    fetch(`/names/${code}`, { signal }).then((response) =>
      response.ok ? response.text() : Promise.reject(new Error(String(response.status))),
    ),
  )

const lookup = Machine.make<Lookup, LookupEvent, string>()({
  initial: (code: string) => Lookup.Idle({ code }),
  on: {
    Idle: { Look: ({ code }) => Lookup.Looking({ code }), ignore: ["Found", "Missed"] },
    Looking: {
      Found: ({ code }, { name }) => Machine.emit(Lookup.Named({ code, name }), name),
      Missed: ({ code }) => Lookup.Failed({ code }),
      ignore: ["Look"],
    },
    Named: { ignore: ["Look", "Found", "Missed"] },
    Failed: { Look: ({ code }) => Lookup.Looking({ code }), ignore: ["Found", "Missed"] },
  },
  work: {
    Looking: ({ code }) =>
      nameOf(code).pipe(
        Effect.map((name) => LookupEvent.Found({ name })),
        Effect.orElseSucceed(() => LookupEvent.Missed()),
      ),
  },
})

interface CountryProps {
  code: string
  onNamed?: (name: string) => void
}

const Country = ({ code, onNamed }: CountryProps) => {
  const [state, send] = useMachine(lookup, { input: code, ...(onNamed && { on: onNamed }) })

  return Lookup.$match(state, {
    Idle: () => (
      <button type="button" onClick={() => send(LookupEvent.Look())}>
        Look up {code}
      </button>
    ),
    Looking: () => <p>Looking up {code}…</p>,
    Named: ({ name }) => <p>{name}</p>,
    Failed: () => (
      <button type="button" onClick={() => send(LookupEvent.Look())}>
        Try {code} again
      </button>
    ),
  })
}

it("shows each state the machine moves through and hands back its output", async () => {
  const user = userEvent.setup()
  const onNamed = vi.fn<(name: string) => void>()

  network.use(http.get("/names/FRA", () => HttpResponse.text("France")))
  render(<Country code="FRA" onNamed={onNamed} />)

  await user.click(screen.getByRole("button", { name: "Look up FRA" }))

  expect(await screen.findByText("France")).toBeDefined()
  expect(onNamed).toHaveBeenCalledExactlyOnceWith("France")
})

it("handles the events work produces from a failure", async () => {
  const user = userEvent.setup()

  network.use(http.get("/names/FRA", () => new HttpResponse(null, { status: 503 })))
  render(<Country code="FRA" />)

  await user.click(screen.getByRole("button", { name: "Look up FRA" }))

  expect(await screen.findByRole("button", { name: "Try FRA again" })).toBeDefined()
})

it("starts again for a new input and drops the previous input's late result", async () => {
  const user = userEvent.setup()
  const { promise: released, resolve: release } = Promise.withResolvers<void>()

  network.use(
    http.get("/names/FRA", async () => {
      await released

      return HttpResponse.text("France")
    }),
    http.get("/names/DEU", () => HttpResponse.text("Germany")),
  )

  const { rerender } = render(<Country code="FRA" />)

  await user.click(screen.getByRole("button", { name: "Look up FRA" }))
  expect(await screen.findByText("Looking up FRA…")).toBeDefined()

  rerender(<Country code="DEU" />)
  release()

  await user.click(screen.getByRole("button", { name: "Look up DEU" }))

  expect(await screen.findByText("Germany")).toBeDefined()
  expect(screen.queryByText("France")).toBeNull()
})
