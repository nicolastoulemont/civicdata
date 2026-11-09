import {
  Change,
  type Dimension,
  DimensionsMissing,
  type IndicatorId,
  IndicatorNotFound,
  Ranking,
  Relation,
  type ResolvedView,
  SourceUnavailable,
  sourceOf,
  TransformNotApplicable,
  transformOf,
  Trend,
  type View,
  Year,
} from "@civicdata/domain"
import { useQuery } from "@tanstack/react-query"
import { Match } from "effect"
import { lazy, Suspense } from "react"

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
import { Dimensions } from "./Dimensions.tsx"
import { Disagreements } from "./Disagreements.tsx"
import { withAgainst, withCountries, withIndicator, withPer, withTransform } from "./edits.ts"
import { Flags } from "./Flags.tsx"
import {
  attribution,
  countryName,
  indicatorNames,
  named,
  period,
  subject,
  transformLabel,
} from "./format.ts"
import { Indicator } from "./Indicator.tsx"
import type { Paired } from "./points.ts"
import { RankingChart } from "./RankingChart.tsx"
import { RelationChart } from "./RelationChart.tsx"
import { ShowAs } from "./ShowAs.tsx"
import { Takeaway } from "./Takeaway.tsx"
import { type History, TrendChart } from "./TrendChart.tsx"
import { range, YearSelect, years } from "./Years.tsx"
import type { Years } from "./YearWindow.tsx"

interface SpanProps {
  from: Year
  to: Year
  onChange: (years: { from: Year; to: Year }) => void
}

// A first and a last year, the last never before the first.
const Span = ({ from, to, onChange }: SpanProps) => {
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

interface YearsProps {
  view: View
  onChange: (view: View) => void
}

// The years the View covers, as the chart type takes them.
const Years = ({ view, onChange }: YearsProps) =>
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

const list = new Intl.ListFormat("en", { type: "conjunction" })

interface AgainstProps {
  view: View
  known: ReadonlyMap<IndicatorId, string>
  onChange: (view: View) => void
}

// The indicator a relation is plotted against; other charts have none.
const Against = ({ view, known, onChange }: AgainstProps) =>
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

interface PerProps {
  view: View
  known: ReadonlyMap<IndicatorId, string>
  onChange: (view: View) => void
}

// The indicator a ratio divides by; other transforms have none.
const Per = ({ view, known, onChange }: PerProps) =>
  Match.value(transformOf(view)).pipe(
    Match.when({ _tag: "Ratio" }, ({ per }) => (
      <div className="min-w-64 flex-1">
        <Indicator
          label="Per"
          current={{ indicator: per, name: known.get(per) ?? per }}
          onChange={(picked) => onChange(withPer(view, picked))}
        />
      </div>
    )),
    Match.orElse(() => null),
  )

interface ControlsProps {
  view: View
  // The names of the indicators loaded so far, by code.
  known: ReadonlyMap<IndicatorId, string>
  // What else an SDMX indicator's series differ by, once known.
  dimensions: ReadonlyArray<Dimension>
  onChange: (view: View) => void
}

const Controls = ({ view, known, dimensions, onChange }: ControlsProps) => {
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
      {dimensions.length === 0 ? null : (
        <div className="flex w-full flex-wrap items-end gap-4">
          <Dimensions view={view} dimensions={dimensions} onChange={onChange} />
        </div>
      )}
      <ShowAs view={view} name={name} onChange={onChange} />
      <Per view={view} known={known} onChange={onChange} />
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

interface ProblemProps {
  error: Error
  retry: () => void
}

const Problem = ({ error, retry }: ProblemProps) =>
  error instanceof TransformNotApplicable ? (
    <Alert variant="destructive">
      <AlertTitle>This view does not apply to {error.indicator}</AlertTitle>
      <AlertDescription>
        Its values are percentages or rates, which cannot be shown per person, as growth, as an
        index or as a ratio.
      </AlertDescription>
    </Alert>
  ) : error instanceof DimensionsMissing ? (
    <Alert>
      <AlertTitle>Choose which series to show</AlertTitle>
      <AlertDescription>
        This dataset has a series for each{" "}
        {list.format(
          error.dimensions
            .filter((dimension) => error.open.includes(dimension.id))
            .map((dimension) => dimension.label.toLowerCase()),
        )}
        . Pick one above.
      </AlertDescription>
    </Alert>
  ) : error instanceof IndicatorNotFound ? (
    <Alert variant="destructive">
      <AlertTitle>Unknown indicator</AlertTitle>
      <AlertDescription>
        {named(sourceOf(error.indicator))} has no indicator {error.indicator}.
      </AlertDescription>
    </Alert>
  ) : (
    <Alert variant="destructive">
      <AlertTitle>
        {error instanceof SourceUnavailable
          ? `${named(error.source)} is not responding`
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

// The map's outlines load only when a map is shown.
const RankingMap = lazy(() =>
  import("./RankingMap.tsx").then((module) => ({ default: module.RankingMap })),
)

// The trend on screen with its whole history, to pick its years over. The
// explorer has one; an answer does not.
interface Picking {
  readonly trend: Trend
  readonly history: History
}

interface SingleProps {
  resolved: Exclude<ResolvedView, Paired>
  picking: Picking | undefined
}

// A chart of one indicator's values.
const Single = ({ resolved, picking }: SingleProps) =>
  Match.valueTags(resolved.view, {
    Trend: (shown) => (
      <TrendChart resolved={resolved} trend={picking?.trend ?? shown} history={picking?.history} />
    ),
    Ranking: (ranking) =>
      ranking.as === "Map" ? (
        <Suspense fallback={<Skeleton className="aspect-2/1 w-full" />}>
          <RankingMap resolved={resolved} />
        </Suspense>
      ) : (
        <RankingChart resolved={resolved} />
      ),
    Change: (change) => <ChangeChart resolved={resolved} change={change} />,
  })

interface ChartProps {
  resolved: ResolvedView
  picking?: Picking | undefined
}

// The chart, and under it the values its source flags and where other
// sources disagree.
export const Chart = ({ resolved, picking }: ChartProps) => (
  <div className="space-y-3">
    {"against" in resolved ? (
      <RelationChart resolved={resolved} />
    ) : (
      <Single resolved={resolved} picking={picking} />
    )}
    <Flags resolved={resolved} />
    <Disagreements resolved={resolved} />
  </div>
)

// A trend's whole history: every year the World Bank could have, with the
// trend's transform. An index starts at the first year shown, so the history
// of an indexed trend holds the values as published.
const historyOf = (view: View) => {
  const transform = transformOf(view)

  return withTransform(
    Trend.make({
      indicator: view.indicator,
      countries: view.countries,
      from: Year.make(1960),
      to: Year.make(new Date().getUTCFullYear()),
    }),
    transform === "Index" ? undefined : transform,
  )
}

// What the trend chart needs to pick a trend's years over its whole history,
// once that history has loaded. Only a trend picks its years; the history
// query is the same for every year picked, so it loads once.
const usePicking = (view: View, onChange: (view: View) => void): Picking | undefined => {
  const trend = Match.value(view).pipe(
    Match.tag("Trend", (shown) => shown),
    Match.orElse(() => undefined),
  )

  const history = useQuery({
    ...resolveQuery(historyOf(view)),
    enabled: trend !== undefined,
  })

  return trend === undefined || history.data === undefined
    ? undefined
    : {
        trend,
        history: {
          observations: history.data.observations,
          same: trend.transform !== "Index",
          onChange: (picked: Years) => onChange(Trend.make({ ...trend, ...picked })),
        },
      }
}

interface ExploreProps {
  view: View
  onChange: (view: View) => void
}

// The explorer for one View. The route keeps the View in the URL; this
// component reports edits through `onChange`.
export const Explore = ({ view, onChange }: ExploreProps) => {
  const query = useQuery(resolveQuery(view))
  const known = indicatorNames(query.data === undefined ? [] : [query.data])
  const picking = usePicking(view, onChange)

  const dimensions =
    query.data?.dimensions ??
    (query.error instanceof DimensionsMissing ? query.error.dimensions : [])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{subject(view, known)}</h1>
          </CardTitle>
          <CardDescription>
            {transformLabel(view, known) === undefined
              ? period(view)
              : `${period(view)} · ${transformLabel(view, known)}`}
          </CardDescription>
          <CardAction>
            <CopyLink view={view} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Controls view={view} known={known} dimensions={dimensions} onChange={onChange} />
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
                    {named(sourceOf(view.indicator))} has no values for {period(view)}.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div
                aria-busy={query.isPlaceholderData}
                className={
                  query.isPlaceholderData ? "opacity-50 transition-opacity" : "transition-opacity"
                }
              >
                <Chart resolved={query.data} picking={picking} />
              </div>
              <Takeaway view={view} />
            </>
          )}
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          {query.data === undefined
            ? `Source: ${sourceOf(view.indicator)}`
            : attribution(query.data)}
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
