import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { routeTree } from "./routeTree.gen.ts"

// One QueryClient per router: the server builds a router per request, so
// requests never share cached data.
export const getRouter = () => {
  const queryClient = new QueryClient()

  return createRouter({
    routeTree,
    scrollRestoration: true,
    Wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}
