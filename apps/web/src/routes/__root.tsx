import type { QueryClient } from "@tanstack/react-query"
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router"
import { Effect, Fiber } from "effect"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { verify } from "@/api"
import { createI18n } from "@/locale"
import { origin } from "@/origin"
import { script } from "@/settings/appearance"

import styles from "@/styles.css?url"

// The head script sets data-theme on <html> before React hydrates it. The
// browser asks for its pass once the page loads (`verify`).
const Root = () => {
  const { i18n } = useTranslation()

  useEffect(() => {
    const fiber = Effect.runFork(verify)

    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [])

  return (
    <html lang={i18n.language} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: () => ({ origin: origin() }),
  // Routes below override the title and description.
  head: ({ loaderData }) => {
    const description = createI18n().getFixedT("en-US", "common")(($) => $.siteDescription)

    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "openfacts" },
        { name: "description", content: description },
        { property: "og:site_name", content: "openfacts" },
        { property: "og:type", content: "website" },
        { property: "og:title", content: "openfacts" },
        { property: "og:description", content: description },
        ...(loaderData === undefined
          ? []
          : [
              { property: "og:image", content: `${loaderData.origin}/preview.png` },
              { property: "og:image:width", content: "1200" },
              { property: "og:image:height", content: "630" },
              { property: "og:image:alt", content: "openfacts" },
              { name: "twitter:card", content: "summary_large_image" },
            ]),
      ],
      links: [
        { rel: "stylesheet", href: styles },
        { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
      // Applies the stored appearance before first paint; the server cannot read
      // browser storage.
      scripts: [{ children: script }],
    }
  },
  component: Root,
})
