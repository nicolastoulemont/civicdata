import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router"

import styles from "@/styles.css?url"

const Root = () => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body>
      <Outlet />
      <Scripts />
    </body>
  </html>
)

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "civicdata" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: Root,
})
