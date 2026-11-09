import type { View } from "@civicdata/domain"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { resolveQuery } from "@/explore/api"
import { Chart } from "@/explore/Explore"
import { attribution, period, transformLabel } from "@/explore/format"
import { places } from "@/explore/preview"
import { toSearch } from "@/explore/search"

// The chart that answered a question, with its source, and a link to change
// it in the explorer.
export const Answer = ({ view }: { view: View }) => {
  const query = useQuery(resolveQuery(view))
  const shows = transformLabel(view)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{query.data?.title ?? view.indicator}</h2>
        </CardTitle>
        <CardDescription>
          {[places(view), period(view), ...(shows === undefined ? [] : [shows])].join(" · ")}
        </CardDescription>
        <CardAction>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            to="/explore"
            search={toSearch(view)}
          >
            Open in the explorer
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {query.isPending ? <Skeleton className="h-64 w-full" /> : null}
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>The data could not be loaded</AlertTitle>
            <AlertDescription>Open the chart in the explorer to try again.</AlertDescription>
          </Alert>
        ) : null}
        {query.data === undefined ? null : <Chart resolved={query.data} />}
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        {query.data === undefined ? "Source: World Bank" : attribution(query.data)}
      </CardFooter>
    </Card>
  )
}
