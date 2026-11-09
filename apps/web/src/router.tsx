import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { persist } from "./persist.ts"
import { routeTree } from "./routeTree.gen.ts"

// One QueryClient per router: the server builds a router per request, so
// requests never share cached data. The browser saves conversations and charts
// in IndexedDB; the server saves nothing.
export const getRouter = () => {
  const queryClient = new QueryClient()

  persist(queryClient)

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Hovering or focusing a link starts loading its page.
    defaultPreload: "intent",
    Wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}
