import type { ResolvedView, View } from "@civicdata/domain"
import type { QueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { createIsomorphicFn } from "@tanstack/react-start"

import { buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { resolve } from "@/explore/api"
import { Explore } from "@/explore/Explore"
import { indicatorNames } from "@/explore/format"
import { inProcess } from "@/explore/inProcess"
import { preview } from "@/explore/preview"
import { type Search, toQuery, toSearch, toView } from "@/explore/search"
import { origin } from "@/origin"

const BrokenLink = () => (
  <main className="flex min-h-svh items-center justify-center p-6">
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1>This link does not describe a chart</h1>
        </CardTitle>
        <CardDescription>
          A country code, indicator or year in the address is invalid, or the years run backwards.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Link className={buttonVariants({ variant: "outline" })} to="/">
          Back to the examples
        </Link>
      </CardFooter>
    </Card>
  </main>
)

// The names of the indicators the page title needs, by code; a name not
// known is left out. The server resolves the View, so link previews name the
// indicators. The browser only reads Views it already resolved, so editing a
// chart never waits on its title.
const namesFor = createIsomorphicFn()
  .server(({ view }: { view: View; queryClient: QueryClient }) =>
    resolve(view, inProcess).then(
      (resolved) => indicatorNames([resolved]),
      () => indicatorNames([]),
    ),
  )
  .client(({ queryClient }) =>
    indicatorNames(
      queryClient
        .getQueriesData<ResolvedView>({ queryKey: ["resolve"] })
        .flatMap(([, resolved]) => (resolved === undefined ? [] : [resolved])),
    ),
  )

const ExplorePage = () => {
  const view = toView(Route.useSearch())
  const navigate = Route.useNavigate()

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <Explore
        view={view}
        onChange={(next) => void navigate({ search: toSearch(next) })}
        heading="h1"
        changing
      />
    </main>
  )
}

export const Route = createFileRoute("/explore")({
  // Types the URL; beforeLoad decides whether it describes a chart.
  validateSearch: (search: Search) => search,
  // An invalid link is a missing page (404), not a server error. Thrown here
  // because the router only accepts notFound() from beforeLoad and loaders.
  beforeLoad: ({ search }) => {
    try {
      toView(search)
    } catch {
      throw notFound()
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context: { queryClient } }) => {
    const view = toView(deps)

    return {
      ...preview(view, await namesFor({ view, queryClient })),
      image: `${origin()}/explore.png${toQuery(view)}`,
    }
  },
  head: ({ loaderData }) => ({
    meta:
      loaderData === undefined
        ? []
        : [
            { title: `${loaderData.title} · civicdata` },
            { name: "description", content: loaderData.description },
            { property: "og:title", content: loaderData.title },
            { property: "og:description", content: loaderData.description },
            { property: "og:image", content: loaderData.image },
            { property: "og:image:alt", content: loaderData.title },
            { property: "og:image:width", content: "600" },
            { property: "og:image:height", content: "315" },
          ],
  }),
  component: ExplorePage,
  notFoundComponent: BrokenLink,
})
