import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { createI18n, LocaleProvider } from "./locale.tsx"
import { persist } from "./persist.ts"
import { routeTree } from "./routeTree.gen.ts"

interface RouterWrapProps {
  children: ReactNode
}

// One QueryClient per router: the server builds a router per request, so
// requests never share cached data. The browser saves conversations and charts
// in IndexedDB; the server saves nothing.
export const getRouter = () => {
  const queryClient = new QueryClient()
  const i18n = createI18n()

  persist(queryClient)

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Hovering or focusing a link starts loading its page.
    defaultPreload: "intent",
    Wrap: ({ children }: RouterWrapProps) => (
      <LocaleProvider instance={i18n}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </LocaleProvider>
    ),
  })
}
