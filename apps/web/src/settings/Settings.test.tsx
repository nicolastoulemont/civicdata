import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it } from "vitest"

import { Route as ChatRoute } from "@/routes/_chat"

// Where the choice is kept. Its format outlives deploys: changing it resets
// every visitor to System.
const key = "civicdata:appearance"

const theme = () => document.documentElement.getAttribute("data-theme")

// The real chat layout over a stand-in home page.
const show = (path = "/") => {
  const Chat = ChatRoute.options.component

  if (Chat === undefined) throw new Error("The chat layout must render its page")

  const root = createRootRoute({ component: Outlet })

  const chat = createRoute({
    id: "_chat",
    getParentRoute: () => root,
    validateSearch: ChatRoute.options.validateSearch,
    component: Chat,
  })

  const home = createRoute({
    path: "/",
    getParentRoute: () => chat,
    component: () => <main>Home</main>,
  })

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider
        router={createRouter({
          routeTree: root.addChildren([chat.addChildren([home])]),
          history: createMemoryHistory({ initialEntries: [path] }),
        })}
      />
    </QueryClientProvider>,
  )
}

const open = async () => {
  await userEvent.click(await screen.findByRole("link", { name: "Settings" }))

  return within(await screen.findByRole("dialog", { name: "Settings" }))
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("data-theme")
})

it("opens Settings from the sidebar, following the system by default", async () => {
  show()

  const settings = await open()
  const appearance = settings.getByRole("radiogroup", { name: "Appearance" })

  expect(
    within(appearance).getByRole("radio", { name: "System" }).getAttribute("aria-checked"),
  ).toBe("true")
  expect(theme()).toBeNull()
})

it("applies Dark at once and keeps it after the page mounts again", async () => {
  const user = userEvent.setup()

  show()
  await user.click((await open()).getByRole("radio", { name: "Dark" }))

  expect(theme()).toBe("dark")

  cleanup()
  show()

  expect((await open()).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe(
    "true",
  )
  expect(theme()).toBe("dark")
})

it("goes back to following the system when System is picked", async () => {
  const user = userEvent.setup()

  localStorage.setItem(key, '"light"')
  document.documentElement.setAttribute("data-theme", "light")
  show()
  await user.click((await open()).getByRole("radio", { name: "System" }))

  expect(theme()).toBeNull()
  expect(localStorage.getItem(key)).toBe('"system"')
})

it("follows the system when what is stored cannot be read", async () => {
  localStorage.setItem(key, '"sepia"')
  show()

  expect((await open()).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe(
    "true",
  )
})

it("closes on Escape, back to the page that opened it", async () => {
  const user = userEvent.setup()

  show()
  await open()
  await user.keyboard("{Escape}")

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(screen.getByText("Home")).toBeDefined()
})

it("opens from a link to Settings", async () => {
  show("/?settings=appearance")

  expect(await screen.findByRole("dialog", { name: "Settings" })).toBeDefined()
})

it("stays closed for a section that does not exist", async () => {
  show("/?settings=sepia")

  expect(await screen.findByText("Home")).toBeDefined()
  expect(screen.queryByRole("dialog")).toBeNull()
})
