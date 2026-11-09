import {
  areas,
  Change,
  type Dimension,
  DimensionsMissing,
  type Politics,
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
import { Fragment, lazy, type ReactNode, Suspense, use, useState } from "react"

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toggle } from "@/components/ui/toggle"
import { Hold } from "@/hold"

import { About } from "./About.tsx"
import { politicsQuery, resolveQuery } from "./api.ts"
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
  picks,
  subject,
  transformLabel,
} from "./format.ts"
import { Indicator } from "./Indicator.tsx"
import type { Paired } from "./points.ts"
import { archives, cited, officialPages, Overlay } from "./politics.ts"
import { places } from "./preview.ts"
import { RankingChart } from "./RankingChart.tsx"
import { RelationChart } from "./RelationChart.tsx"
import { ShowAs } from "./ShowAs.tsx"
import { type Agent, Takeaway } from "./Takeaway.tsx"
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

// The trend on screen with its whole history, to pick its years over, while
// the chart is being changed.
interface Picking {
  readonly trend: Trend
  readonly history: History
}

interface SingleProps {
  resolved: Exclude<ResolvedView, Paired>
  picking: Picking | undefined
  politics: Politics | undefined
}

// A chart of one indicator's values.
const Single = ({ resolved, picking, politics }: SingleProps) =>
  Match.valueTags(resolved.view, {
    Trend: (shown) => (
      <TrendChart
        resolved={resolved}
        trend={picking?.trend ?? shown}
        history={picking?.history}
        governments={politics?.governments}
        elections={politics?.elections}
        events={politics?.events}
        reforms={politics?.reforms}
      />
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
  politics: Politics | undefined
}

// The chart, and under it the values its source flags and where other
// sources disagree.
const Chart = ({ resolved, picking, politics }: ChartProps) => (
  <div className="space-y-3">
    {"against" in resolved ? (
      <RelationChart resolved={resolved} />
    ) : (
      <Single resolved={resolved} picking={picking} politics={politics} />
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

interface PickingOptions {
  // Whether the controls are open. The history loads only then, so a
  // conversation with several trends asks for none until one is changed.
  enabled: boolean
  onChange: (view: View) => void
}

// What the trend chart needs to pick a trend's years over its whole history,
// once that history has loaded. Only a trend picks its years; the history
// query is the same for every year picked, so it loads once.
const usePicking = (view: View, { enabled, onChange }: PickingOptions): Picking | undefined => {
  const trend = Match.value(view).pipe(
    Match.tag("Trend", (shown) => shown),
    Match.orElse(() => undefined),
  )

  const history = useQuery({
    ...resolveQuery(historyOf(view)),
    enabled: enabled && trend !== undefined,
  })

  return !enabled || trend === undefined || history.data === undefined
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

// The About tab's headings sit one level below the card's title.
const below = { h1: "h2", h3: "h4" } as const

// The line under the title: where, when, as what, and which series.
const describe = (view: View, resolved: ResolvedView | undefined) => {
  const shows = transformLabel(view, indicatorNames(resolved === undefined ? [] : [resolved]))

  return [
    places(view),
    period(view),
    ...(shows === undefined ? [] : [shows]),
    ...(resolved === undefined ? [] : picks(resolved)),
  ].join(" · ")
}

interface SectionsProps {
  view: View
  resolved: ResolvedView
  // Whether the chart is the previous one, shown while the changed one loads.
  stale: boolean
  picking: Picking | undefined
  // What the chart tab shows above the chart: its overlays' controls and notes.
  above: ReactNode
  politics: Politics | undefined
  heading: "h1" | "h3"
  onChange: (view: View) => void
}

// The chart, the table behind it, and what the indicator measures, a tab
// each. A tab mounts only while open, so About asks for its notes then.
const Sections = ({
  view,
  resolved,
  stale,
  picking,
  above,
  politics,
  heading,
  onChange,
}: SectionsProps) => {
  const hold = use(Hold)

  return (
    <Tabs defaultValue="chart" onValueChange={hold}>
      <TabsList>
        <TabsTrigger value="chart">Chart</TabsTrigger>
        <TabsTrigger value="data">Data</TabsTrigger>
        <TabsTrigger value="about">About</TabsTrigger>
      </TabsList>
      <TabsContent value="chart" className="flex flex-col gap-4">
        {above}
        {resolved.missing.length > 0 ? (
          <Alert>
            <AlertTitle>No data for {resolved.missing.map(countryName).join(", ")}</AlertTitle>
            <AlertDescription>
              {named(sourceOf(view.indicator))} has no values for {period(view)}.
            </AlertDescription>
          </Alert>
        ) : null}
        <div
          aria-busy={stale}
          className={stale ? "opacity-50 transition-opacity" : "transition-opacity"}
        >
          <Chart resolved={resolved} picking={picking} politics={politics} />
        </div>
      </TabsContent>
      <TabsContent value="data">
        <Data resolved={resolved} />
      </TabsContent>
      <TabsContent value="about">
        <About
          resolved={resolved}
          heading={below[heading]}
          onSwitch={(entry) =>
            onChange(withIndicator(view, { id: entry.indicator, name: entry.name }))
          }
        />
      </TabsContent>
    </Tabs>
  )
}

// What each overlay's toggle and notes call its records.
const overlayNames: Record<Overlay, { toggle: string; records: string }> = {
  elections: { toggle: "Elections", records: "election" },
  governments: { toggle: "Governments", records: "government" },
  events: { toggle: "Events", records: "event" },
}

// The overlays whose records PPEG and ParlGov keep for each country, so a
// country without any has no records rather than nothing that happened.
const archived = (overlays: ReadonlyArray<Overlay>) =>
  overlays.filter((overlay) => overlay !== "events")

// The records the chart shows, as a reader would name them: "election or
// government records".
const recordsNamed = (overlays: ReadonlyArray<Overlay>) =>
  `${overlays.map((overlay) => overlayNames[overlay].records).join(" or ")} records`

interface OverlaysProps {
  // None for a chart other than a trend, which shows no political context.
  trend: Trend | undefined
  overlays: ReadonlyArray<Overlay>
  // The records of the overlays on, once loaded.
  records: Politics | undefined
  failed: boolean
  onOverlays: (overlays: ReadonlyArray<Overlay>) => void
}

// The toggles that draw elections, governments and events over a trend, and
// what the chart cannot show: a country without election or government
// records says so, since no band or marker would read as nothing happening.
// Events are few by design, so a country with none has nothing to say.
const Overlays = ({ trend, overlays, records, failed, onOverlays }: OverlaysProps) => {
  const hold = use(Hold)

  if (trend === undefined) return null

  const kept = archived(overlays)

  const unrecorded = trend.countries.filter(
    (country) =>
      records !== undefined &&
      kept.length > 0 &&
      ![...records.governments, ...records.elections].some((record) => record.country === country),
  )

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {Overlay.literals.map((overlay) => (
          <Toggle
            key={overlay}
            variant="outline"
            size="sm"
            pressed={overlays.includes(overlay)}
            onPressedChange={(pressed) => {
              hold()
              onOverlays(
                Overlay.literals.filter((each) =>
                  each === overlay ? pressed : overlays.includes(each),
                ),
              )
            }}
          >
            {overlayNames[overlay].toggle}
          </Toggle>
        ))}
      </div>
      {failed ? (
        <Alert>
          <AlertTitle>
            {recordsNamed(overlays).replace(/^./, (first) => first.toUpperCase())} are unavailable
          </AlertTitle>
          <AlertDescription>Try again later.</AlertDescription>
        </Alert>
      ) : null}
      {unrecorded.length > 0 ? (
        <Alert>
          <AlertTitle>
            No {recordsNamed(kept)} for {unrecorded.map(countryName).join(", ")}
          </AlertTitle>
          <AlertDescription>
            PPEG and ParlGov record the elections and governments of EU and OECD members, each from
            a different year. Neither covers {period(trend)} for{" "}
            {unrecorded.length > 1 ? "these countries" : "it"}.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

interface CreditsProps {
  overlays: ReadonlyArray<Overlay>
  records: Politics | undefined
}

interface EventCreditsProps {
  records: Politics | undefined
}

// The pages the events and reforms on a chart cite, numbered as their lines
// in the chart's tooltip say. Nothing while the chart shows none.
const EventCredits = ({ records }: EventCreditsProps) => {
  const pages = cited([...(records?.events ?? []), ...(records?.reforms ?? [])])

  return pages.length === 0 ? null : (
    <>
      {" Events: sources "}
      {pages.map((page, index) => (
        <Fragment key={page.url}>
          {index === 0 ? "" : " "}
          <a
            className="underline underline-offset-4"
            href={page.url}
            aria-label={`${index + 1}, ${page.publisher}: ${page.title}`}
            title={`${page.publisher}: ${page.title}`}
          >
            {index + 1}
          </a>
        </Fragment>
      ))}
      .
    </>
  )
}

interface ArchiveCreditsProps {
  // The overlays on whose records the archives keep.
  overlays: ReadonlyArray<Overlay>
  records: Politics | undefined
}

// The archives the elections and governments on a chart come from, and the
// official pages checked by hand after them.
const ArchiveCredits = ({ overlays, records }: ArchiveCreditsProps) => {
  if (overlays.length === 0) return null

  const pages = officialPages([...(records?.governments ?? []), ...(records?.elections ?? [])])
  const kinds = overlays.map((overlay) => overlayNames[overlay].toggle.toLowerCase())

  return (
    <>
      {` ${kinds.join(" and ").replace(/^./, (first) => first.toUpperCase())}: `}
      <a className="underline underline-offset-4" href={archives.PPEG.url}>
        {archives.PPEG.name}
      </a>
      {", "}
      <a className="underline underline-offset-4" href={archives.ParlGov.url}>
        {archives.ParlGov.name}
      </a>
      {pages.length === 0 ? null : (
        <>
          {", official records "}
          {pages.map((url, index) => (
            <Fragment key={url}>
              {index === 0 ? "" : " "}
              <a className="underline underline-offset-4" href={url}>
                {index + 1}
              </a>
            </Fragment>
          ))}
        </>
      )}
      .
    </>
  )
}

// The sources of the elections, governments and events on a chart, as each
// asks to be cited. Nothing while the chart shows none of them.
const Credits = ({ overlays, records }: CreditsProps) => (
  <>
    <ArchiveCredits overlays={archived(overlays)} records={records} />
    {overlays.includes("events") ? <EventCredits records={records} /> : null}
  </>
)

const nothing: Politics = { governments: [], elections: [], events: [], reforms: [] }

interface ShownOptions {
  overlays: ReadonlyArray<Overlay>
  indicator: IndicatorId
}

// The records of the overlays on. A reform shows only on a chart of its
// policy area.
const shownOf = (loaded: Politics, { overlays, indicator }: ShownOptions): Politics => ({
  governments: overlays.includes("governments") ? loaded.governments : nothing.governments,
  elections: overlays.includes("elections") ? loaded.elections : nothing.elections,
  events: overlays.includes("events") ? loaded.events : nothing.events,
  reforms: overlays.includes("events")
    ? loaded.reforms.filter((reform) => areas[reform.area].has(indicator))
    : nothing.reforms,
})

// The elections, governments and events a card draws over its chart: only a
// trend's, and only those whose overlay is on.
const usePolitics = (view: View, overlays: ReadonlyArray<Overlay>) => {
  const trend = Match.value(view).pipe(
    Match.tag("Trend", (shown) => shown),
    Match.orElse(() => undefined),
  )

  const on = trend === undefined ? [] : overlays
  const query = useQuery(politicsQuery(on.length === 0 ? undefined : trend))
  const loaded = on.length === 0 ? undefined : query.data

  return {
    trend,
    overlays: on,
    records:
      loaded === undefined
        ? undefined
        : shownOf(loaded, { overlays: on, indicator: view.indicator }),
    failed: on.length > 0 && query.isError,
  }
}

interface ExploreProps {
  view: View
  onChange: (view: View) => void
  // What the chart draws over a trend's lines, outside the View.
  overlays: ReadonlyArray<Overlay>
  onOverlays: (overlays: ReadonlyArray<Overlay>) => void
  // The card's title: the page's own heading on /explore, or a heading under
  // the question in a conversation.
  heading: "h1" | "h3"
  // Whether the controls start open.
  changing?: boolean
  // The chart the agent answered with and its takeaway, in a conversation.
  agent?: Agent | undefined
}

// The explorer card for one View: its chart, the table behind it and what it
// measures, with the controls to change it. The caller keeps the View; this
// component reports changes through `onChange`. Every change holds a
// conversation's scrolling where it is, so the card stays under the pointer.
export const Explore = ({
  view,
  onChange,
  overlays,
  onOverlays,
  heading: Heading,
  changing: initial = false,
  agent,
}: ExploreProps) => {
  const hold = use(Hold)
  const [changing, setChanging] = useState(initial)

  const change = (next: View) => {
    hold()
    onChange(next)
  }

  const query = useQuery(resolveQuery(view))
  const known = indicatorNames(query.data === undefined ? [] : [query.data])
  const picking = usePicking(view, { enabled: changing, onChange: change })

  const political = usePolitics(view, overlays)

  const dimensions =
    query.data?.dimensions ??
    (query.error instanceof DimensionsMissing ? query.error.dimensions : [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Heading>{subject(view, known)}</Heading>
        </CardTitle>
        <CardDescription>{describe(view, query.data)}</CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Toggle
            variant="outline"
            size="sm"
            pressed={changing}
            onPressedChange={(pressed) => {
              hold()
              setChanging(pressed)
            }}
          >
            Change
          </Toggle>
          <CopyLink view={view} overlays={overlays} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {changing ? (
          <Controls view={view} known={known} dimensions={dimensions} onChange={change} />
        ) : null}
        {query.isPending ? <Skeleton className="h-80 w-full" /> : null}
        {query.isError ? <Problem error={query.error} retry={() => void query.refetch()} /> : null}
        {query.data === undefined ? null : (
          <>
            <Takeaway view={view} agent={agent} onChange={change} />
            <Sections
              view={view}
              resolved={query.data}
              stale={query.isPlaceholderData}
              picking={picking}
              above={<Overlays {...political} onOverlays={onOverlays} />}
              politics={political.records}
              heading={Heading}
              onChange={change}
            />
          </>
        )}
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <p>
          {query.data === undefined
            ? `Source: ${sourceOf(view.indicator)}`
            : attribution(query.data)}
          <Credits overlays={political.overlays} records={political.records} />
        </p>
      </CardFooter>
    </Card>
  )
}
