import {
  Change,
  type IndicatorId,
  IndicatorNotFound,
  Ranking,
  Relation,
  type ResolvedView,
  SourceUnavailable,
  TransformNotApplicable,
  Trend,
  type View,
  type Year,
} from "@civicdata/domain"
import { useQuery } from "@tanstack/react-query"
import { Match } from "effect"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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

import { About } from "./About.tsx"
import { resolveQuery } from "./api.ts"
import { ChangeChart } from "./ChangeChart.tsx"
import { ChartType } from "./ChartType.tsx"
import { CopyLink } from "./CopyLink.tsx"
import { Countries } from "./Countries.tsx"
import { Data } from "./Data.tsx"
import { withAgainst, withCountries, withIndicator } from "./edits.ts"
import {
  attribution,
  countryName,
  indicatorNames,
  period,
  subject,
  transformLabel,
} from "./format.ts"
import { Indicator } from "./Indicator.tsx"
import type { Paired } from "./points.ts"
import { RankingChart } from "./RankingChart.tsx"
import { RelationChart } from "./RelationChart.tsx"
import { ShowAs } from "./ShowAs.tsx"
import { TrendChart } from "./TrendChart.tsx"
import { range, YearSelect, years } from "./Years.tsx"

// A first and a last year, the last never before the first.
const Span = ({
  from,
  to,
  onChange,
}: {
  from: Year
  to: Year
  onChange: (years: { from: Year; to: Year }) => void
}) => {
  const all = years()

  return (
    <>
      <YearSelect
        label="From"
        value={from}
        options={range(all[0] ?? from, to)}
        onChange={(next) => onChange({ from: next, to })}
      />
      <YearSelect
        label="To"
        value={to}
        options={all.filter((year) => year >= from)}
        onChange={(next) => onChange({ from, to: next })}
      />
    </>
  )
}

// The years the View covers, as the chart type takes them.
const Years = ({ view, onChange }: { view: View; onChange: (view: View) => void }) =>
  Match.valueTags(view, {
    Trend: (trend) => (
      <Span
        from={trend.from}
        to={trend.to}
        onChange={(span) => onChange(Trend.make({ ...trend, ...span }))}
      />
    ),
    Change: (change) => (
      <Span
        from={change.from}
        to={change.to}
        onChange={(span) => onChange(Change.make({ ...change, ...span }))}
      />
    ),
    Ranking: (ranking) => (
      <YearSelect
        label="Year"
        value={ranking.year}
        options={years()}
        onChange={(year) => onChange(Ranking.make({ ...ranking, year }))}
      />
    ),
    Relation: (relation) => (
      <YearSelect
        label="Year"
        value={relation.year}
        options={years()}
        onChange={(year) => onChange(Relation.make({ ...relation, year }))}
      />
    ),
  })

// The indicator a relation is plotted against; other charts have none.
const Against = ({
  view,
  known,
  onChange,
}: {
  view: View
  known: ReadonlyMap<IndicatorId, string>
  onChange: (view: View) => void
}) =>
  Match.value(view).pipe(
    Match.tag("Relation", (relation) => (
      <div className="w-full">
        <Indicator
          label="Against"
          current={{
            indicator: relation.against,
            name: known.get(relation.against) ?? relation.against,
          }}
          onChange={(picked) => onChange(withAgainst(relation, picked))}
        />
      </div>
    )),
    Match.orElse(() => null),
  )

const Controls = ({
  view,
  known,
  onChange,
}: {
  view: View
  // The names of the indicators loaded so far, by code.
  known: ReadonlyMap<IndicatorId, string>
  onChange: (view: View) => void
}) => {
  const name = known.get(view.indicator)

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex w-full flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1">
          <Indicator
            current={{ indicator: view.indicator, name: name ?? view.indicator }}
            onChange={(picked) => onChange(withIndicator(view, picked))}
          />
        </div>
        <ChartType view={view} onChange={onChange} />
      </div>
      <Against view={view} known={known} onChange={onChange} />
      <ShowAs view={view} name={name} onChange={onChange} />
      <div className="min-w-64 flex-1">
        <Countries
          selected={view.countries}
          onChange={(countries) => onChange(withCountries(view, countries))}
        />
      </div>
      <Years view={view} onChange={onChange} />
    </div>
  )
}

const Problem = ({ error, retry }: { error: Error; retry: () => void }) =>
  error instanceof TransformNotApplicable ? (
    <Alert variant="destructive">
      <AlertTitle>This view does not apply to {error.indicator}</AlertTitle>
      <AlertDescription>
        Its values are percentages or rates, which cannot be shown per person, as growth or as an
        index.
      </AlertDescription>
    </Alert>
  ) : error instanceof IndicatorNotFound ? (
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

// A chart of one indicator's values.
const Single = ({ resolved }: { resolved: Exclude<ResolvedView, Paired> }) =>
  Match.valueTags(resolved.view, {
    Trend: (trend) => <TrendChart resolved={resolved} countries={trend.countries} />,
    Ranking: () => <RankingChart resolved={resolved} />,
    Change: (change) => <ChangeChart resolved={resolved} change={change} />,
  })

export const Chart = ({ resolved }: { resolved: ResolvedView }) =>
  "against" in resolved ? <RelationChart resolved={resolved} /> : <Single resolved={resolved} />

// The explorer for one View. The route keeps the View in the URL; this
// component reports edits through `onChange`.
export const Explore = ({ view, onChange }: { view: View; onChange: (view: View) => void }) => {
  const query = useQuery(resolveQuery(view))
  const known = indicatorNames(query.data === undefined ? [] : [query.data])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{subject(view, known)}</h1>
          </CardTitle>
          <CardDescription>
            {transformLabel(view) === undefined
              ? period(view)
              : `${period(view)} · ${transformLabel(view)}`}
          </CardDescription>
          <CardAction>
            <CopyLink view={view} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Controls view={view} known={known} onChange={onChange} />
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
          {query.data === undefined ? "Source: World Bank" : attribution(query.data)}
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
