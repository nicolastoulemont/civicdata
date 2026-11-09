import { sourceOf, type View } from "@civicdata/domain"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { resolveQuery } from "@/explore/api"
import { CopyLink } from "@/explore/CopyLink"
import { Chart } from "@/explore/Explore"
import {
  attribution,
  indicatorNames,
  period,
  picks,
  subject,
  transformLabel,
} from "@/explore/format"
import { places } from "@/explore/preview"
import { toSearch } from "@/explore/search"

import { Actions } from "./Row.tsx"

// The chart that answered a question, with its source, then links to change
// it in the explorer and to share it.
export const Answer = ({ view }: { view: View }) => {
  const query = useQuery(resolveQuery(view))
  const known = indicatorNames(query.data === undefined ? [] : [query.data])
  const shows = transformLabel(view, known)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h3>{subject(view, known)}</h3>
          </CardTitle>
          <CardDescription>
            {[
              places(view),
              period(view),
              ...(shows === undefined ? [] : [shows]),
              ...(query.data === undefined ? [] : picks(query.data)),
            ].join(" · ")}
          </CardDescription>
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
          {query.data === undefined
            ? `Source: ${sourceOf(view.indicator)}`
            : attribution(query.data)}
        </CardFooter>
      </Card>
      <Actions>
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          to="/explore"
          search={toSearch(view)}
        >
          Open in the explorer
        </Link>
        <CopyLink view={view} />
      </Actions>
    </>
  )
}
