import { createFileRoute, Link, notFound } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Explore } from "@/explore/Explore"
import { type Search, toSearch, toView } from "@/explore/search"

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

const ExplorePage = () => {
  const view = toView(Route.useSearch())
  const navigate = Route.useNavigate()

  return <Explore view={view} onChange={(next) => void navigate({ search: toSearch(next) })} />
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
  component: ExplorePage,
  notFoundComponent: BrokenLink,
})
