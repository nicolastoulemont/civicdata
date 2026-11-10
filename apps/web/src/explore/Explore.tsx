import {
  areas,
  Change,
  type Dimension,
  DimensionsMissing,
  type Politics,
  type IndicatorId,
  IndicatorNotFound,
  Overlay,
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
import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query"
import { Data, Match, Struct } from "effect"
import { Fragment, type ReactNode, use, useState } from "react"

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Hold } from "@/hold"
import { useMachine } from "@/machine"

import { About } from "./About.tsx"
import { politicsQuery, resolveQuery } from "./api.ts"
import { ChangeChart } from "./ChangeChart.tsx"
import { ChartType } from "./ChartType.tsx"
import { CopyLink } from "./CopyLink.tsx"
import { Countries } from "./Countries.tsx"
import { Data as Table } from "./Data.tsx"
import { Dimensions } from "./Dimensions.tsx"
import { Disagreements } from "./Disagreements.tsx"
import type { Years } from "./drag.ts"
import {
  oneYear,
  type Spanned,
  withAgainst,
  withCountries,
  withIndicator,
  withPer,
  withSpan,
  withYear,
} from "./edits.ts"
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
import { historyOf, SpanEvent, Spanning, spanning } from "./history.ts"
import { Indicator } from "./Indicator.tsx"
import type { Moving } from "./OverTime.tsx"
import type { Paired } from "./points.ts"
import { archives, cited, officialPages, terms, tints } from "./politics.ts"
import { places } from "./preview.ts"
import { RankedChart } from "./RankedChart.tsx"
import { RelatedChart } from "./RelatedChart.tsx"
import { ShowAs } from "./ShowAs.tsx"
import { Takeaway } from "./Takeaway.tsx"
import { type History, TrendChart } from "./TrendChart.tsx"
import { range, YearSelect, years } from "./Years.tsx"

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
    Ranking: (ranking) => <SpanYears view={ranking} onChange={onChange} />,
    Relation: (relation) => <SpanYears view={relation} onChange={onChange} />,
  })

interface SpanYearsProps {
  view: Spanned
  onChange: (view: View) => void
}

// One year, or a span of years the chart moves through with a slider.
// Switching to over time first loads the chart's whole history, to start the
// span at the first year every country shares.
const SpanYears = ({ view, onChange }: SpanYearsProps) => {
  const queryClient = useQueryClient()
  const [state, send] = useMachine(spanning, { input: { view, queryClient }, on: onChange })

  return (
    <>
      <ToggleGroup
        aria-label="Years shown"
        variant="outline"
        value={[view.span === undefined ? "one" : "over"]}
        onValueChange={(next: Array<string>) => {
          if (next.includes("one") && view.span !== undefined) onChange(oneYear(view))

          if (next.includes("over") && view.span === undefined) send(SpanEvent.Ask())
        }}
      >
        <ToggleGroupItem value="one">One year</ToggleGroupItem>
        <ToggleGroupItem value="over" disabled={Spanning.$is("Loading")(state)}>
          Over time
        </ToggleGroupItem>
      </ToggleGroup>
      {view.span === undefined ? (
        <YearSelect
          label="Year"
          value={view.year}
          options={years()}
          onChange={(year) => onChange(withYear(view, year))}
        />
      ) : (
        <Span
          from={view.span.from}
          to={view.span.to}
          onChange={(span) => onChange(withSpan(view, span))}
        />
      )}
      {Spanning.$is("Failed")(state) ? (
        <Alert variant="destructive">
          <AlertTitle>The years could not be loaded</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

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

// The trend on screen with its whole history, to pick its years over, while
// the chart is being changed: off for a chart other than a trend or while the
// controls are closed, then the View's own history once loaded.
type Picking = Data.TaggedEnum<{
  Off: {}
  Loading: {}
  Ready: { readonly trend: Trend; readonly history: History }
  Failed: {}
}>

const Picking = Data.taggedEnum<Picking>()

// The trend the chart draws: the one being picked once its history is ready,
// or else the one on screen, without a history.
const pickedOf = (picking: Picking, shown: Trend) =>
  Picking.$is("Ready")(picking) ? picking : { trend: shown, history: undefined }

interface SingleProps {
  resolved: Exclude<ResolvedView, Paired>
  picking: Picking
  moving: Moving | undefined
  politics: Politics | undefined
}

// A chart of one indicator's values.
const Single = ({ resolved, picking, moving, politics }: SingleProps) =>
  Match.valueTags(resolved.view, {
    Trend: (shown) => {
      const { trend, history } = pickedOf(picking, shown)

      return (
        <>
          <TrendChart
            resolved={resolved}
            trend={trend}
            history={history}
            governments={politics?.governments}
            elections={politics?.elections}
            events={politics?.events}
            reforms={politics?.reforms}
          />
          {Picking.$is("Failed")(picking) ? (
            <Alert>
              <AlertTitle>The chart's history could not be loaded</AlertTitle>
              <AlertDescription>Pick its years with From and To above.</AlertDescription>
            </Alert>
          ) : null}
        </>
      )
    },
    Ranking: (view) => <RankedChart resolved={{ ...resolved, view }} moving={moving} />,
    Change: (change) => <ChangeChart resolved={resolved} change={change} />,
  })

interface ChartProps {
  resolved: ResolvedView
  picking: Picking
  moving?: Moving | undefined
  politics: Politics | undefined
}

// The chart, and under it the values its source flags and where other
// sources disagree.
const Chart = ({ resolved, picking, moving, politics }: ChartProps) => (
  <div className="space-y-3">
    {"against" in resolved ? (
      <RelatedChart resolved={resolved} moving={moving} />
    ) : (
      <Single resolved={resolved} picking={picking} moving={moving} politics={politics} />
    )}
    <Flags resolved={resolved} />
    <Disagreements resolved={resolved} />
  </div>
)

interface PickingOptions {
  // Whether the controls are open. The history loads only then, so a
  // conversation with several trends asks for none until one is changed.
  enabled: boolean
  onChange: (view: View) => void
}

interface PickingOf {
  history: UseQueryResult<ResolvedView>
  onChange: (view: View) => void
}

// A trend's picking, none while picking is off. Another trend's history,
// kept while this one's loads, is not this trend's.
const pickingOf = (trend: Trend | undefined, { history, onChange }: PickingOf): Picking => {
  if (trend === undefined) return Picking.Off()

  if (history.isError) return Picking.Failed()

  return history.data === undefined || history.isPlaceholderData
    ? Picking.Loading()
    : Picking.Ready({
        trend,
        history: {
          observations: history.data.observations,
          same: trend.transform !== "Index",
          onChange: (picked: Years) =>
            onChange(Trend.make({ ...Struct.omit(trend, ["from", "to"]), ...picked })),
        },
      })
}

// What the trend chart needs to pick a trend's years over its whole history.
// Only a trend picks its years; the history query is the same for every year
// picked, so it loads once.
const usePicking = (view: View, { enabled, onChange }: PickingOptions): Picking => {
  const trend = Match.value(view).pipe(
    Match.tag("Trend", (shown) => (enabled ? shown : undefined)),
    Match.orElse(() => undefined),
  )

  const history = useQuery({
    ...resolveQuery(historyOf(view)),
    enabled: trend !== undefined,
  })

  return pickingOf(trend, { history, onChange })
}

interface MovingOptions {
  // The chart the agent answered with, in a conversation.
  agent: View | undefined
  onChange: (view: View) => void
}

// How a ranking or relation over time moves through its years: from the year
// it saves, with the agent's year marked when the agent answered with a
// chart of one year or over time. Every year the slider lets go on, or play
// pauses on, is saved as a change of the View.
const movingOf = (view: View, { agent, onChange }: MovingOptions): Moving | undefined => {
  const answered = Match.value(agent).pipe(
    Match.tag("Ranking", "Relation", (chart) => chart.year),
    Match.orElse(() => undefined),
  )

  return Match.value(view).pipe(
    Match.tag("Ranking", (ranking) =>
      ranking.span === undefined
        ? undefined
        : {
            year: ranking.year,
            agent: answered,
            onYear: (year: Year) => onChange(Ranking.make({ ...ranking, year })),
          },
    ),
    Match.tag("Relation", (relation) =>
      relation.span === undefined
        ? undefined
        : {
            year: relation.year,
            agent: answered,
            onYear: (year: Year) => onChange(Relation.make({ ...relation, year })),
          },
    ),
    Match.orElse(() => undefined),
  )
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
  refreshing: boolean
  picking: Picking
  moving: Moving | undefined
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
  refreshing,
  picking,
  moving,
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
          aria-busy={refreshing}
          className={refreshing ? "opacity-50 transition-opacity" : "transition-opacity"}
        >
          <Chart resolved={resolved} picking={picking} moving={moving} politics={politics} />
        </div>
      </TabsContent>
      <TabsContent value="data">
        <Table resolved={resolved} />
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

// The records of the overlays on: none while every overlay is off, then the
// trend's own once loaded. While they load, the previous trend's records stay
// drawn, but only the trend's own say which countries have none: the
// previous ones would name the countries just added.
type Records = Data.TaggedEnum<{
  Off: {}
  Loading: {}
  Refreshing: { readonly politics: Politics }
  Failed: {}
  Loaded: { readonly politics: Politics }
}>

const Records = Data.taggedEnum<Records>()

interface OverlaysProps {
  // None for a chart other than a trend, which shows no political context.
  trend: Trend | undefined
  overlays: ReadonlyArray<Overlay>
  records: Records
  onOverlays: (overlays: ReadonlyArray<Overlay>) => void
}

// The toggles that draw elections, governments and events over a trend, and
// what the chart cannot show: a country without election or government
// records says so, since no band or marker would read as nothing happening.
// Events are few by design, so a country with none has nothing to say.
const Overlays = ({ trend, overlays, records, onOverlays }: OverlaysProps) => {
  const hold = use(Hold)

  if (trend === undefined) return null

  const kept = archived(overlays)

  const unrecorded = Records.$is("Loaded")(records)
    ? trend.countries.filter(
        (country) =>
          kept.length > 0 &&
          ![...records.politics.governments, ...records.politics.elections].some(
            (record) => record.country === country,
          ),
      )
    : []

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
      {Records.$is("Failed")(records) ? (
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
  countries: View["countries"]
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

interface ColorCreditsProps {
  records: Politics | undefined
  countries: View["countries"]
}

// The page that sets each party colour a chart's bands take: the party's own
// brand page, or the party's Wikidata entry. Bands show on a chart of one
// country only.
const ColorCredits = ({ records, countries }: ColorCreditsProps) => {
  const colors = countries.length === 1 ? tints(terms(records?.governments ?? [])) : []

  return colors.length === 0 ? null : (
    <>
      {" Party colours "}
      {colors.map((color, index) => (
        <Fragment key={color.url}>
          {index === 0 ? "" : " "}
          <a
            className="underline underline-offset-4"
            href={color.url}
            aria-label={`Party colour ${index + 1}, ${color.kind === "brand" ? "the party's brand" : "Wikidata"}`}
          >
            {index + 1}
          </a>
        </Fragment>
      ))}
      .
    </>
  )
}

// The sources of the elections, governments and events on a chart, as each
// asks to be cited. Nothing while the chart shows none of them.
const Credits = ({ overlays, records, countries }: CreditsProps) => (
  <>
    <ArchiveCredits overlays={archived(overlays)} records={records} />
    <ColorCredits records={records} countries={countries} />
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

const recordsOf = (
  { data, isError, isPlaceholderData }: UseQueryResult<Politics>,
  shown: ShownOptions,
) => {
  if (shown.overlays.length === 0) return Records.Off()

  if (isError) return Records.Failed()

  if (data === undefined) return Records.Loading()

  const politics = shownOf(data, shown)

  return isPlaceholderData ? Records.Refreshing({ politics }) : Records.Loaded({ politics })
}

// The records a chart draws: its own, or the previous trend's while its own
// load.
const drawn = (records: Records) =>
  Records.$match(records, {
    Off: () => undefined,
    Loading: () => undefined,
    Refreshing: ({ politics }) => politics,
    Failed: () => undefined,
    Loaded: ({ politics }) => politics,
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

  return {
    trend,
    overlays: on,
    records: recordsOf(query, { overlays: on, indicator: view.indicator }),
  }
}

// What the card shows of a View: nothing yet, why it failed, its chart, or
// while an edited View loads, the previous chart. Only a result of the View on
// screen moves its years, picks its series or marks its countries.
type Display = Data.TaggedEnum<{
  Loading: {}
  Failed: { readonly error: Error }
  Shown: { readonly resolved: ResolvedView }
  Refreshing: { readonly previous: ResolvedView }
}>

const Display = Data.taggedEnum<Display>()

const displayOf = ({ data, error, isPlaceholderData }: UseQueryResult<ResolvedView>): Display =>
  error !== null
    ? Display.Failed({ error })
    : data === undefined
      ? Display.Loading()
      : isPlaceholderData
        ? Display.Refreshing({ previous: data })
        : Display.Shown({ resolved: data })

// What else an SDMX indicator's series differ by, once known: from the View's
// result, from the error asking to pick them, or while another View of the
// same indicator loads, from that one's.
const dimensionsOf = (display: Display, view: View): ReadonlyArray<Dimension> =>
  Match.valueTags(display, {
    Loading: () => [],
    Failed: ({ error }) => (error instanceof DimensionsMissing ? error.dimensions : []),
    Shown: ({ resolved }) => resolved.dimensions,
    Refreshing: ({ previous }) =>
      previous.view.indicator === view.indicator ? previous.dimensions : [],
  })

interface ResultProps {
  display: Display
  retry: () => void
  // Draws a result: the View's own, or while it loads, the previous one.
  children: (resolved: ResolvedView, options: { refreshing: boolean }) => ReactNode
}

const Result = ({ display, retry, children }: ResultProps) =>
  Match.valueTags(display, {
    Loading: () => <Skeleton className="h-80 w-full" />,
    Failed: ({ error }) => <Problem error={error} retry={retry} />,
    Shown: ({ resolved }) => children(resolved, { refreshing: false }),
    Refreshing: ({ previous }) => children(previous, { refreshing: true }),
  })

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
  // The chart the agent answered with, in a conversation.
  agent?: View | undefined
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
  const display = displayOf(query)
  const known = indicatorNames(query.data === undefined ? [] : [query.data])
  const picking = usePicking(view, { enabled: changing, onChange: change })

  const political = usePolitics(view, overlays)
  const politics = drawn(political.records)

  const sections = (resolved: ResolvedView, { refreshing }: { refreshing: boolean }) => (
    <>
      <Takeaway view={view} agent={agent} onChange={change} />
      <Sections
        view={view}
        resolved={resolved}
        refreshing={refreshing}
        picking={picking}
        // The previous chart's years are not the View's, so nothing moves them.
        moving={refreshing ? undefined : movingOf(view, { agent, onChange: change })}
        above={<Overlays {...political} onOverlays={onOverlays} />}
        politics={politics}
        heading={Heading}
        onChange={change}
      />
    </>
  )

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
          <Controls
            view={view}
            known={known}
            dimensions={dimensionsOf(display, view)}
            onChange={change}
          />
        ) : null}
        <Result display={display} retry={() => void query.refetch()}>
          {sections}
        </Result>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <p>
          {query.data === undefined
            ? `Source: ${sourceOf(view.indicator)}`
            : attribution(query.data)}
          <Credits overlays={political.overlays} records={politics} countries={view.countries} />
        </p>
      </CardFooter>
    </Card>
  )
}
