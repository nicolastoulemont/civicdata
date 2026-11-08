import {
  IndicatorNotFound,
  Ranking,
  type ResolvedView,
  SourceUnavailable,
  Trend,
  type View,
} from "@civicdata/domain"
import { useQuery } from "@tanstack/react-query"
import { Match, Schema } from "effect"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

import { About, retrieved } from "./About.tsx"
import { resolveQuery } from "./api.ts"
import { ChartType } from "./ChartType.tsx"
import { Countries } from "./Countries.tsx"
import { Data } from "./Data.tsx"
import { withCountries, withIndicator } from "./edits.ts"
import { countryName } from "./format.ts"
import { Indicator } from "./Indicator.tsx"
import { RankingChart } from "./RankingChart.tsx"
import { TrendChart } from "./TrendChart.tsx"
import { range, YearSelect, years } from "./Years.tsx"

const isTrend = Schema.is(Trend)

const period = (view: View) =>
  Match.valueTags(view, {
    Trend: ({ from, to }) => `${from}–${to}`,
    Ranking: ({ year }) => `${year}`,
  })

const Controls = ({
  view,
  name,
  onChange,
}: {
  view: View
  name: string
  onChange: (view: View) => void
}) => {
  const all = years()

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex w-full flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1">
          <Indicator
            current={{ indicator: view.indicator, name }}
            onChange={(indicator) => onChange(withIndicator(view, indicator))}
          />
        </div>
        <ChartType view={view} onChange={onChange} />
      </div>
      <div className="min-w-64 flex-1">
        <Countries
          selected={view.countries}
          onChange={(countries) => onChange(withCountries(view, countries))}
        />
      </div>
      {isTrend(view) ? (
        <>
          <YearSelect
            label="From"
            value={view.from}
            options={range(all[0] ?? view.from, view.to)}
            onChange={(from) => onChange(Trend.make({ ...view, from }))}
          />
          <YearSelect
            label="To"
            value={view.to}
            options={all.filter((year) => year >= view.from)}
            onChange={(to) => onChange(Trend.make({ ...view, to }))}
          />
        </>
      ) : (
        <YearSelect
          label="Year"
          value={view.year}
          options={all}
          onChange={(year) => onChange(Ranking.make({ ...view, year }))}
        />
      )}
    </div>
  )
}

const Problem = ({ error, retry }: { error: Error; retry: () => void }) =>
  error instanceof IndicatorNotFound ? (
    <Alert variant="destructive">
      <AlertTitle>Unknown indicator</AlertTitle>
      <AlertDescription>The World Bank has no indicator {error.indicator}.</AlertDescription>
    </Alert>
  ) : (
    <Alert variant="destructive">
      <AlertTitle>
        {error instanceof SourceUnavailable
          ? "The World Bank is not responding"
          : "The data could not be loaded"}
      </AlertTitle>
      <AlertDescription>
        <p>Try again in a moment.</p>
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )

const Chart = ({ resolved }: { resolved: ResolvedView }) =>
  Match.valueTags(resolved.view, {
    Trend: (trend) => <TrendChart resolved={resolved} countries={trend.countries} />,
    Ranking: () => <RankingChart resolved={resolved} />,
  })

// The explorer for one View. The route keeps the View in the URL; this
// component reports edits through `onChange`.
export const Explore = ({ view, onChange }: { view: View; onChange: (view: View) => void }) => {
  const query = useQuery(resolveQuery(view))

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{query.data?.indicator.name ?? view.indicator}</h1>
          </CardTitle>
          <CardDescription>{period(view)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Controls
            view={view}
            name={query.data?.indicator.name ?? view.indicator}
            onChange={onChange}
          />
          {query.isPending ? <Skeleton className="h-80 w-full" /> : null}
          {query.isError ? (
            <Problem error={query.error} retry={() => void query.refetch()} />
          ) : null}
          {query.data === undefined ? null : (
            <>
              {query.data.missing.length > 0 ? (
                <Alert>
                  <AlertTitle>
                    No data for {query.data.missing.map(countryName).join(", ")}
                  </AlertTitle>
                  <AlertDescription>
                    The World Bank has no values for {period(view)}.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div
                aria-busy={query.isPlaceholderData}
                className={
                  query.isPlaceholderData ? "opacity-50 transition-opacity" : "transition-opacity"
                }
              >
                <Chart resolved={query.data} />
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          {query.data === undefined
            ? "Source: World Bank"
            : `Source: World Bank, ${query.data.provenance.dataset}. Retrieved ${retrieved(query.data)}.`}
        </CardFooter>
      </Card>
      {query.data === undefined ? null : (
        <>
          <About resolved={query.data} />
          <Data resolved={query.data} />
        </>
      )}
    </main>
  )
}
