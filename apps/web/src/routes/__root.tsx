import type { QueryClient } from "@tanstack/react-query"
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router"

import { origin } from "@/origin"
import { script } from "@/settings/appearance"

import styles from "@/styles.css?url"

// The head script sets data-theme on <html> before React hydrates it.
const Root = () => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <HeadContent />
    </head>
    <body>
      <Outlet />
      <Scripts />
    </body>
  </html>
)

const description = "Charts of public data about countries, with the source of every number."

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: () => ({ origin: origin() }),
  // Routes below override the title and description.
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "civicdata" },
      { name: "description", content: description },
      { property: "og:site_name", content: "civicdata" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "civicdata" },
      { property: "og:description", content: description },
      ...(loaderData === undefined
        ? []
        : [
            { property: "og:image", content: `${loaderData.origin}/preview.png` },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
            { property: "og:image:alt", content: "civicdata" },
            { name: "twitter:card", content: "summary_large_image" },
          ]),
    ],
    links: [{ rel: "stylesheet", href: styles }],
    // Applies the stored appearance before first paint; the server cannot read
    // browser storage.
    scripts: [{ children: script }],
  }),
  component: Root,
})
