import {
  AgentUnavailable,
  Answered,
  Asked,
  type Block,
  CatalogUnavailable,
  Change,
  Chart,
  type ChartIndex,
  Cited,
  Country,
  Coverage,
  Covered,
  Definition,
  type Dimension,
  Dimensions,
  type DimensionsMissing,
  End,
  type Explanation,
  Evidence,
  Failed,
  Fetch,
  Fetched,
  type Finding,
  bylineOf,
  idOf,
  IndicatorId,
  IndicatorNotes,
  type IndicatorNotFound,
  kindOf,
  Located,
  locate,
  Lookup,
  members,
  Overlay,
  type Overlays,
  type Politics as PoliticalRecords,
  Ranking,
  Ratio,
  Read,
  Recorded,
  RecordId,
  Records,
  Rejected,
  Rejection,
  Relation,
  Rendered,
  Research,
  Researched,
  type ResolvedView,
  Running,
  Scope,
  Search,
  Searched,
  Source,
  SourceUnavailable,
  sourceOf,
  type Step,
  StepId,
  Text,
  Thinking,
  Thought,
  transformOf,
  type TransformNotApplicable,
  Trend,
  Unanswered,
  Unresolved,
  View,
  When,
  type Work,
  Year,
} from "@civicdata/domain"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import {
  Array as Arr,
  type Cause,
  Context,
  DateTime,
  Effect,
  Layer,
  Match,
  Option,
  Queue,
  Redacted,
  Ref,
  Result,
  Schema,
  type SchemaIssue,
  Stream,
  Struct,
} from "effect"
import { Chat, LanguageModel, Prompt, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"

import { Catalog } from "./Catalog.ts"
import { cite } from "./Citations.ts"
import { Findings } from "./Findings.ts"
import { Notes } from "./Notes.ts"
import { Politics } from "./Politics.ts"
import { Resolver } from "./Resolver.ts"
import { Sdmx } from "./Sdmx.ts"
import { recent } from "./Series.ts"
import { coverage, Summary, summarize } from "./Summary.ts"
import { WorldBank } from "./WorldBank.ts"

// Why an answer could not be given at all.
type Failure = AgentUnavailable | SourceUnavailable | CatalogUnavailable

// Why a chart could not be explained.
type Unexplained =
  | AgentUnavailable
  | SourceUnavailable
  | IndicatorNotFound
  | TransformNotApplicable
  | DimensionsMissing

// A chart a person changed since the agent's last answer: the one on screen,
// and its place in the answer.
export interface Changed {
  readonly chart: ChartIndex
  readonly view: View
}

// A question, and the charts a person changed since the agent's last answer.
interface Asking {
  readonly question: string
  readonly changed: ReadonlyArray<Changed>
}

interface Interface {
  // A new chat that knows how to answer, with no questions yet.
  readonly start: Effect.Effect<Chat.Chat>
  // Answers a question asked in the chat, streaming what the agent does. The
  // stream ends with Answered, Asked or Unanswered, and the chat then holds
  // the question and the answer, so a follow-up can build on them.
  readonly ask: (chat: Chat.Chat, asked: Asking) => Stream.Stream<Step, Failure>
  // What a chart on its own shows, outside a chat, e.g. after someone edited
  // the chart the agent showed.
  readonly explain: (view: View) => Effect.Effect<Explanation, Unexplained>
}

// Used when the deployment does not name a model in OPENAI_MODEL.
export const defaultModel = "gpt-6.1-terra"

// Model turns before the agent gives up on a question: enough for each of
// three charts to search, read a definition, look up places, look up years,
// be fixed once and be written about. Each turn is one model request.
const rounds = 18

// Earlier questions the model is sent again with a new one. Older questions,
// with everything the agent did to answer them, leave the chat, so a long
// conversation costs no more per question than a short one.
const recall = 3

// The chat's instructions and its last `recall` questions. Each question
// starts with the person's message, so the cut never splits a tool call from
// its result.
const forget = (prompt: Prompt.Prompt) => {
  const questions = prompt.content.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  )

  const first = questions.at(-recall)

  return first === undefined
    ? prompt
    : Prompt.fromMessages([
        ...prompt.content.filter((message) => message.role === "system"),
        ...prompt.content.slice(first),
      ])
}

// Where a tool reports its step while it runs: to the answer that called it.
class Report extends Context.Service<Report, (step: Work) => Effect.Effect<void>>()(
  "@civicdata/server/Agent/Report",
) {}

// The political records the answer's lookups found, by id: the only ones
// its words can cite.
class Known extends Context.Service<Known, Ref.Ref<ReadonlyMap<string, Cited>>>()(
  "@civicdata/server/Agent/Known",
) {}

// Why a step failed.
type Reason = typeof Failed.Type.reason

// Runs a tool's work as one step, reported running, then as `done` says from
// its result, or failed with its error. `at` makes the step in a state.
const reported = Effect.fnUntraced(function* <A, E extends Reason, R>(
  work: Effect.Effect<A, E, R>,
  {
    at,
    done,
  }: {
    readonly at: (state: typeof Running.Type | typeof Failed.Type) => Work
    readonly done: (result: A) => Work
  },
) {
  const report = yield* Report

  yield* report(at(Running.make({})))

  const result = yield* work.pipe(Effect.tapError((reason) => report(at(Failed.make({ reason })))))

  yield* report(done(result))

  return result
})

// A tool call's step id. A chat always passes the call's id.
const stepOf = (id: string | undefined, tool: string) => StepId.make(id ?? tool)

const SearchIndicators = Tool.make("search_indicators", {
  description:
    "Search the indicators of the World Bank, Eurostat and the OECD by words in their name or definition, or by code. Returns up to 10 matches, best first, each with its source.",
  parameters: Schema.Struct({
    text: Schema.String.annotate({
      description: "Words to search for, e.g. 'life expectancy' or 'GDP per capita'",
    }),
    source: Schema.NullOr(Source).annotate({
      description: "Only this source's indicators; null for all three",
    }),
  }),
  success: Schema.Array(
    Schema.Struct({
      indicator: IndicatorId,
      source: Source,
      name: Schema.String,
      definition: Schema.String,
    }),
  ),
  failure: Schema.Union([SourceUnavailable, CatalogUnavailable]),
  dependencies: [Report],
})

// What show_chart tells the model: the chart was shown with a summary of its
// values, or why it was not. describe_indicator also answers Rejected for a
// code that does not exist.
const Shown = Schema.TaggedStruct("Shown", {
  view: View,
  overlays: Schema.optionalKey(Schema.NonEmptyArray(Overlay)),
  data: Summary,
})

const Refused = Schema.TaggedStruct("Rejected", { problem: Schema.String })

// What describe_indicator tells the model: the indicator's definition and
// what its source writes about it, or null for the notes when the source
// cannot be reached now.
const Defined = Schema.TaggedStruct("Definition", {
  indicator: IndicatorId,
  source: Source,
  name: Schema.String,
  definition: Schema.String,
  dataset: Schema.String,
  notes: Schema.NullOr(IndicatorNotes),
})

const FindCountries = Tool.make("find_countries", {
  description:
    "Look up the ISO 3166-1 alpha-3 codes of countries by name, e.g. 'Ivory Coast' or 'South Korea'. show_chart takes these codes for every source. Returns the matches for each name, best first; several matches mean the name is ambiguous, none that no source has data for it.",
  parameters: Schema.Struct({
    names: Schema.Array(Schema.String).annotate({
      description: "Place names as the question writes them",
    }),
  }),
  success: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      matches: Schema.Array(Schema.Struct({ code: Schema.String, name: Schema.String })),
    }),
  ),
  dependencies: [Report],
})

// What find_politics tells the model: each record with its id, and the
// countries that have no political records.
const Found = Schema.TaggedStruct("Records", {
  governments: Schema.Array(
    Schema.Struct({
      id: RecordId,
      country: Country,
      head: Schema.String,
      parties: Schema.Array(Schema.String),
      start: Schema.String,
      end: Schema.NullOr(Schema.String),
    }),
  ),
  elections: Schema.Array(
    Schema.Struct({ id: RecordId, country: Country, ballot: Schema.String, date: Schema.String }),
  ),
  events: Schema.Array(
    Schema.Struct({
      id: RecordId,
      name: Schema.String,
      from: Schema.String,
      to: Schema.NullOr(Schema.String),
      summary: Schema.String,
    }),
  ),
  reforms: Schema.Array(
    Schema.Struct({
      id: RecordId,
      country: Country,
      name: Schema.String,
      date: Schema.String,
      summary: Schema.String,
    }),
  ),
  uncovered: Schema.Array(Country),
})

// The countries and years find_politics and find_research look up, as the
// model passes them.
const range = {
  countries: Schema.Array(Schema.String).annotate({
    description: "ISO 3166-1 alpha-3 codes, e.g. FRA, DEU",
  }),
  from: Schema.Int.annotate({ description: "First year" }),
  to: Schema.Int.annotate({ description: "Last year" }),
}

const FindPolitics = Tool.make("find_politics", {
  description:
    "Look up the elections, governments, major events and pension reforms of countries over a range of years, from stored records with their sources. Records cover EU and OECD members; `uncovered` lists the countries without any. Each record has an id, which your words cite it by.",
  parameters: Schema.Struct(range),
  success: Schema.Union([Found, Schema.TaggedStruct("Rejected", { problem: Schema.String })]),
  dependencies: [Report, Known],
})

// What find_research tells the model of each finding: its id, its name and
// claim, where and when it holds, how settled it is, and its studies by
// author and year, on either side of a dispute.
const Explained = Schema.TaggedStruct("Findings", {
  findings: Schema.Array(
    Schema.Struct({
      id: RecordId,
      name: Schema.String,
      claim: Schema.String,
      countries: Schema.Union([Schema.Literal("world"), Schema.Array(Country)]),
      from: Year,
      to: Year,
      settled: Schema.Literals(["agreed", "one study", "disputed"]),
      objection: Schema.NullOr(Schema.String),
      supporting: Schema.Array(Schema.String),
      disputing: Schema.Array(Schema.String),
    }),
  ),
})

const FindResearch = Tool.make("find_research", {
  description:
    "Look up the research findings that explain why an indicator moved in some countries over some years. Each finding is one result of reviewed studies, in our words, with how settled it is: agreed, one study, or disputed with an objection. Returns only findings that cover the indicator, at least one of the countries and some of the years; none means the research we have does not cover the question. Each finding has an id, which your words cite it by.",
  parameters: Schema.Struct({
    indicator: Schema.String.annotate({
      description: "The indicator code of the chart, as search_indicators returned it",
    }),
    ...range,
  }),
  success: Schema.Union([Explained, Schema.TaggedStruct("Rejected", { problem: Schema.String })]),
  dependencies: [Report, Known],
})

const AskUser = Tool.make("ask_user", {
  description:
    "Ask the person which of a few readings of their question they mean, when the readings give different charts and none is a safe default. Their reply is the next message. Ask at most once per question.",
  parameters: Schema.Struct({
    question: Schema.String.annotate({ description: "A short question, e.g. 'Which GDP?'" }),
    choices: Schema.Array(Schema.String).annotate({
      description: "Two to four short answers, e.g. 'In current dollars', 'Adjusted for inflation'",
    }),
  }),
  success: Schema.String,
})

// What a chart is about, as find_years and show_chart take it: an
// indicator, its countries and, for Eurostat and OECD, its series.
const subject = {
  indicator: Schema.String.annotate({
    description: "An indicator code returned by search_indicators, e.g. SP.DYN.LE00.IN",
  }),
  countries: Schema.Array(Schema.String).annotate({
    description:
      "ISO 3166-1 alpha-3 codes of single economies, e.g. FRA, BRA. No regions or groups.",
  }),
  dimensions: Schema.NullOr(
    Schema.Array(Schema.Struct({ dimension: Schema.String, code: Schema.String })),
  ).annotate({
    description:
      "For a Eurostat or OECD indicator, the code of each dimension its series differ by, e.g. [{ dimension: 'sex', code: 'T' }]. A rejection lists the dimensions and their codes. null for World Bank indicators.",
  }),
}

const DescribeIndicator = Tool.make("describe_indicator", {
  description:
    "Read an indicator's full definition and its source's notes on it: how the source measures it, its limitations, how far it compares across countries and over time, and its breaks in series. Use it to tell close indicators apart, e.g. GDP in current dollars from GDP adjusted for inflation, and to answer why a line jumps, why two sources disagree, or how a figure is measured.",
  parameters: Schema.Struct({
    indicator: subject.indicator,
    countries: Schema.Array(Schema.String).annotate({
      description:
        "ISO 3166-1 alpha-3 codes of the countries the question is about, e.g. IRL, for the OECD's notes on them; [] for none",
    }),
    dimensions: subject.dimensions,
  }),
  success: Schema.Union([Defined, Refused]),
  failure: SourceUnavailable,
  dependencies: [Report],
})

// What find_years tells the model: the indicator's name, the years it looked
// at, and which of them have values for each country.
const Years = Schema.TaggedStruct("Years", {
  name: Schema.String,
  from: Year,
  to: Year,
  countries: Covered.fields.countries,
  shared: Covered.fields.shared,
  missing: Covered.fields.missing,
})

const FindYears = Tool.make("find_years", {
  description:
    "Look up which years an indicator has values for in each country, over the last 30 years, to pick a chart's years before show_chart. Returns each country's first and last year with a value, the runs of years every country with values has one in (`shared`), and the countries with no value at all (`missing`).",
  parameters: Schema.Struct(subject),
  success: Schema.Union([Years, Refused]),
  failure: SourceUnavailable,
  dependencies: [Report],
})

// The chart types show_chart draws. A map is a ranking drawn on the map of the
// narrowest region holding every country, else on a world map.
const Form = Schema.Literals(["trend", "ranking", "map", "change", "relation"])

const ShowChart = Tool.make("show_chart", {
  description:
    "Show one chart of a World Bank, Eurostat or OECD indicator in the answer, after what you wrote so far. The chart is checked against the data; when it is rejected, fix what the problem names and call again. Returns a summary of the charted values to write about.",
  parameters: Schema.Struct({
    chart: Form.annotate({
      description:
        "trend: one line per country over a range of years. ranking: countries compared in one year, as bars, or over a span of years with a slider. map: a ranking drawn as a map, of the narrowest region holding every country (e.g. the Gulf states, Europe, East Asia, Africa), else of the world. change: each country's value in two years, from and to. relation: one dot per country in one year, the indicator against another, or over a span of years with a slider that moves each dot.",
    }),
    indicator: subject.indicator,
    against: Schema.NullOr(Schema.String).annotate({
      description:
        "The indicator code a relation plots the indicator against, e.g. NY.GDP.PCAP.CD; null for other charts",
    }),
    countries: subject.countries,
    from: Schema.NullOr(Schema.Int).annotate({
      description: "First year of a trend or a change; null otherwise",
    }),
    to: Schema.NullOr(Schema.Int).annotate({
      description: "Last year of a trend or a change; null otherwise",
    }),
    year: Schema.NullOr(Schema.Int).annotate({
      description:
        "The year of a ranking, a map or a relation; null otherwise. A chart over time shows this year first and the person can move to others.",
    }),
    span_from: Schema.NullOr(Schema.Int).annotate({
      description:
        "First year of a ranking, map or relation over time, which the person moves through with a slider; null for one of a single year, and for a trend or a change",
    }),
    span_to: Schema.NullOr(Schema.Int).annotate({
      description:
        "Last year of a ranking, map or relation over time; null for one of a single year, and for a trend or a change",
    }),
    transform: Schema.NullOr(Schema.Literals(["PerPerson", "Growth", "Index", "Ratio"])).annotate({
      description:
        "PerPerson divides a total by population. Growth is the annual % change. Index sets a trend's first year to 100. Ratio divides by the indicator in per. A change takes only PerPerson and Ratio, and a relation none. null shows values as published.",
    }),
    per: Schema.NullOr(Schema.String).annotate({
      description: "The indicator code a Ratio divides by, e.g. NY.GDP.MKTP.CD; null otherwise",
    }),
    dimensions: subject.dimensions,
    overlays: Schema.NullOr(Schema.Array(Overlay)).annotate({
      description:
        "For a trend, the political context drawn over its lines: elections, governments (shaded by head of government) and events (with pension reforms on pension charts). null for none, and for other charts.",
    }),
  }),
  success: Schema.Union([Shown, Refused]),
  failure: SourceUnavailable,
  dependencies: [Report],
})

const Tools = Toolkit.make(
  SearchIndicators,
  DescribeIndicator,
  FindCountries,
  FindPolitics,
  FindResearch,
  FindYears,
  ShowChart,
  AskUser,
)

// A chat leaves tool arguments undecoded; ask_user's are checked again to
// show its question.
const isAsk = Schema.is(AskUser.parametersSchema)
const isShown = Schema.is(Shown)

type Draft = typeof ShowChart.parametersSchema.Type

// A View's fields without its tag: what the model's arguments decode to.
const TrendFields = Trend.mapFields(Struct.omit(["_tag"]))
const RankingFields = Ranking.mapFields(Struct.omit(["_tag"]))
const ChangeFields = Change.mapFields(Struct.omit(["_tag"]))
const RelationFields = Relation.mapFields(Struct.omit(["_tag"]))
const RatioFields = Ratio.mapFields(Struct.omit(["_tag"]))

// makeEffect reports a failed check as a bare Issue.
const checked = <A>(made: Effect.Effect<A, SchemaIssue.Issue>) =>
  Effect.mapError(made, (issue) => new Schema.SchemaError(issue))

// The View the model described. Decodes the fields the chart type takes, then
// builds the View, which checks it, e.g. that the years run forwards. A
// transform or a span the chart type does not take is an error, not dropped.
const toView = Effect.fnUntraced(function* (draft: Draft) {
  const { indicator, against, countries, from, to, year } = draft

  // A ratio carries the indicator it divides by.
  const transform =
    draft.transform === "Ratio"
      ? Ratio.make(yield* Schema.decodeUnknownEffect(RatioFields)({ per: draft.per }))
      : draft.transform

  const fields: Record<
    string,
    | Draft[keyof Draft]
    | Ratio
    | Readonly<Record<string, string>>
    | { readonly from: number | null; readonly to: number | null }
  > = Match.value(draft.chart).pipe(
    Match.whenOr("trend", "change", () => ({ indicator, countries, from, to })),
    Match.when("ranking", () => ({ indicator, countries, year })),
    Match.when("map", () => ({ indicator, countries, year, as: "Map" })),
    Match.when("relation", () => ({ indicator, against, countries, year })),
    Match.exhaustive,
  )

  if (transform !== null) fields["transform"] = transform

  if (draft.span_from !== null || draft.span_to !== null)
    fields["span"] = { from: draft.span_from, to: draft.span_to }

  if (draft.dimensions !== null && draft.dimensions.length > 0)
    fields["dimensions"] = Object.fromEntries(
      draft.dimensions.map(({ dimension, code }) => [dimension, code]),
    )

  const decode = <S extends Schema.Top>(schema: S) =>
    Schema.decodeUnknownEffect(schema)(fields, { onExcessProperty: "error" })

  return yield* Match.value(draft.chart).pipe(
    Match.when("trend", () =>
      decode(TrendFields).pipe(Effect.flatMap((made) => checked(Trend.makeEffect(made)))),
    ),
    Match.whenOr("ranking", "map", () =>
      decode(RankingFields).pipe(Effect.flatMap((made) => checked(Ranking.makeEffect(made)))),
    ),
    Match.when("change", () =>
      decode(ChangeFields).pipe(Effect.flatMap((made) => checked(Change.makeEffect(made)))),
    ),
    Match.when("relation", () =>
      decode(RelationFields).pipe(Effect.flatMap((made) => checked(Relation.makeEffect(made)))),
    ),
    Match.exhaustive,
  )
})

// The arguments show_chart would take to draw the View: toView's inverse.
const draftOf = (view: View): Draft => {
  const transform = transformOf(view)

  const fields = {
    overlays: null,
    indicator: view.indicator,
    against: null,
    countries: view.countries,
    from: null,
    to: null,
    year: null,
    span_from: null,
    span_to: null,
    transform: transform === undefined ? null : kindOf(transform),
    per: Match.value(transform).pipe(
      Match.when({ _tag: "Ratio" }, ({ per }) => per),
      Match.orElse(() => null),
    ),
    dimensions:
      view.dimensions === undefined
        ? null
        : Object.entries(view.dimensions).map(([dimension, code]) => ({ dimension, code })),
  }

  return Match.valueTags(view, {
    Trend: ({ from, to }): Draft => ({ ...fields, chart: "trend", from, to }),
    Ranking: ({ as, year, span }): Draft => ({
      ...fields,
      chart: as === "Map" ? "map" : "ranking",
      year,
      span_from: span?.from ?? null,
      span_to: span?.to ?? null,
    }),
    Change: ({ from, to }): Draft => ({ ...fields, chart: "change", from, to }),
    Relation: ({ against, year, span }): Draft => ({
      ...fields,
      chart: "relation",
      against,
      year,
      span_from: span?.from ?? null,
      span_to: span?.to ?? null,
    }),
  })
}

// The question as the model reads it. The charts the person changed since the
// agent's last answer lead the question, each with its place in the answer
// and as show_chart's arguments, so a follow-up changes what it asks for and
// keeps the rest. They travel in the question's own message: `forget` cuts
// the chat at questions, and a note of its own would count as one.
const prompted = ({ question, changed }: Asking) =>
  changed.length === 0
    ? question
    : `The person changed charts on screen since your last answer. ${changed
        .map(
          ({ chart, view }) =>
            `Chart ${chart + 1} is now show_chart ${JSON.stringify(draftOf(view))}.`,
        )
        .join(" ")}\n\n${question}`

const rejected = (problem: string) => Refused.make({ problem })

// A chart the data cannot show: why, for people, and what to fix, for the model.
interface Refusal<R extends Rejection = Rejection> {
  readonly reason: R
  readonly problem: string
}

const refuse = <R extends Rejection>(reason: R, problem: string) =>
  Result.fail<Refusal<R>>({ reason, problem })

// A trend ends at the latest year it has values for. Told only the current
// year, the model asks for years the World Bank has not published yet. A
// change names its two years, so it is kept as asked.
const trim = ({ view, observations }: ResolvedView): View =>
  Match.valueTags(view, {
    Trend: (trend) =>
      Trend.make({
        ...trend,
        to: observations.reduce((latest, { year }) => (year > latest ? year : latest), trend.from),
      }),
    Ranking: (ranking) => ranking,
    Change: (change) => change,
    Relation: (relation) => relation,
  })

// A dimension and its first codes as the model reads them:
// "sex (F Females, M Males, T Total)".
const listed = ({ id, options }: Dimension) =>
  `${id} (${options
    .slice(0, 20)
    .map(({ code, label }) => `${code} ${label}`)
    .join(", ")}${options.length > 20 ? ", …" : ""})`

// Why a chart has no values. Eurostat and OECD charts read annual data
// only, so a quarterly or monthly dataflow has none.
const noValues = (source: Source) =>
  source === "World Bank"
    ? "The World Bank has no values for these countries and years. Try other years."
    : `${source} has no annual values for these countries and years. Try other years, or another dataflow if this one is quarterly or monthly only.`

// What describe_indicator reads the notes on: the OECD writes some on single
// countries and series.
const Described = Schema.Struct({
  indicator: IndicatorId,
  countries: Schema.Array(Country),
  dimensions: Dimensions,
})

const forwards = Schema.makeFilter(
  ({ from, to }: { readonly from: Year; readonly to: Year }) =>
    from <= to || "from must not be after to",
)

const spanned = {
  countries: Schema.NonEmptyArray(Country).check(Schema.isUnique()),
  from: Year,
  to: Year,
}

// The countries and years find_politics reads the records of.
const Span = Schema.Struct(spanned).check(forwards)

// The indicator, countries and years find_research reads the findings of.
const Explaining = Schema.Struct({ indicator: IndicatorId, ...spanned }).check(forwards)

// The overlays a chart drew, each once and in their usual order, or none.
const overlaysOf = (draft: Draft): Overlays | undefined => {
  const on = Overlay.literals.filter((overlay) => draft.overlays?.includes(overlay))

  return Arr.isArrayNonEmpty(on) ? on : undefined
}

// Every record of a lookup.
const citedIn = (records: PoliticalRecords): ReadonlyArray<Cited> => [
  ...records.governments.map((government) => Cited.cases.Government.make({ government })),
  ...records.elections.map((election) => Cited.cases.Election.make({ election })),
  ...records.events.map((event) => Cited.cases.Event.make({ event })),
  ...records.reforms.map((reform) => Cited.cases.Reform.make({ reform })),
]

// The records as find_politics tells them to the model.
const told = (records: PoliticalRecords, countries: ReadonlyArray<Country>) =>
  Found.make({
    governments: records.governments.map((government) => ({
      id: idOf(Cited.cases.Government.make({ government })),
      country: government.country,
      head: government.head,
      parties: government.parties.map(({ name, abbreviation }) =>
        abbreviation === null ? name : `${name} (${abbreviation})`,
      ),
      start: government.start,
      end: End.match(government.end, {
        Next: ({ day }) => day,
        Cutoff: ({ day }) => day,
        Open: () => null,
      }),
    })),
    elections: records.elections.map((election) => ({
      id: idOf(Cited.cases.Election.make({ election })),
      country: election.country,
      ballot: election.ballot,
      date: election.date,
    })),
    events: records.events.map((event) => ({
      id: idOf(Cited.cases.Event.make({ event })),
      name: event.name,
      ...When.match(event.when, {
        Point: ({ at }) => ({ from: at.date, to: at.date }),
        Period: ({ from, to }) => ({ from: from.date, to: to?.date ?? null }),
      }),
      summary: event.summary,
    })),
    reforms: records.reforms.map((reform) => ({
      id: idOf(Cited.cases.Reform.make({ reform })),
      country: reform.country,
      name: reform.name,
      date: reform.date,
      summary: reform.summary,
    })),
    uncovered: countries.filter((country) => !members.has(country)),
  })

// The findings as find_research tells them to the model.
const explained = (findings: ReadonlyArray<Finding>) =>
  Explained.make({
    findings: findings.map((finding) => ({
      id: idOf(Cited.cases.Finding.make({ finding })),
      name: finding.name,
      claim: finding.claim,
      countries: Scope.match(finding.scope, {
        World: () => "world" as const,
        Countries: ({ countries }) => countries,
      }),
      from: finding.from,
      to: finding.to,
      ...Evidence.match(finding.evidence, {
        Agreed: ({ studies }) => ({
          settled: "agreed" as const,
          objection: null,
          supporting: studies.map(bylineOf),
          disputing: [],
        }),
        Single: ({ study }) => ({
          settled: "one study" as const,
          objection: null,
          supporting: [bylineOf(study)],
          disputing: [],
        }),
        Disputed: ({ supporting, disputing, objection }) => ({
          settled: "disputed" as const,
          objection,
          supporting: supporting.map(bylineOf),
          disputing: disputing.map(bylineOf),
        }),
      }),
    })),
  })

// Adds the records a lookup found to those the answer's words can cite.
const know = (records: ReadonlyArray<Cited>) =>
  Effect.flatMap(Known, (known) =>
    Ref.update(
      known,
      (before) => new Map([...before, ...records.map((cited) => [idOf(cited), cited] as const)]),
    ),
  )

const ToolsLayer = Tools.toLayer(
  Effect.gen(function* () {
    const catalog = yield* Catalog
    const resolver = yield* Resolver
    const worldBank = yield* WorldBank
    const sdmx = yield* Sdmx
    const politics = yield* Politics
    const research = yield* Findings
    const notes = yield* Notes

    // A View's values, or why the data cannot give them: no source has the
    // indicator, or its dataflow holds several series and the View has not
    // picked one. find_years and show_chart tell the model the same problem.
    const resolve = (
      view: View,
    ): Effect.Effect<
      Result.Result<ResolvedView, Refusal<typeof Unresolved.Type.reason>>,
      SourceUnavailable | TransformNotApplicable
    > =>
      resolver.resolve(view).pipe(
        Effect.map(Result.succeed),
        Effect.catchTags({
          IndicatorNotFound: ({ indicator }) =>
            Effect.succeed(
              refuse(
                Rejection.cases.NoIndicator.make({ indicator }),
                `There is no indicator ${indicator}. Search for one.`,
              ),
            ),
          DimensionsMissing: ({ indicator, dimensions, open }) =>
            Effect.succeed(
              refuse(
                Rejection.cases.OpenDimensions.make({ open }),
                `${indicator} holds several series. Pass one code for each of these dimensions: ${dimensions
                  .filter((dimension) => open.includes(dimension.id))
                  .map(listed)
                  .join("; ")}.`,
              ),
            ),
        }),
      )

    // Draws the chart the model described, once it decodes and the data has
    // values for it. Only a trend draws political context.
    const draw = (draft: Draft, toolCallId: string | undefined) =>
      toView(draft).pipe(
        Effect.flatMap((view) => {
          const overlays = overlaysOf(draft)

          if (overlays !== undefined && draft.chart !== "trend") {
            return Effect.succeed(
              rejected("Only a trend shows elections, governments or events. Pass overlays null."),
            )
          }

          const at = (state: typeof Fetch.Type.state) =>
            Fetch.make({ id: stepOf(toolCallId, "show_chart"), view, state })

          const fetched: Effect.Effect<
            Result.Result<ResolvedView, Refusal>,
            SourceUnavailable
          > = resolve(view).pipe(
            Effect.map(
              Result.flatMap((values) =>
                values.observations.length === 0
                  ? refuse(Rejection.cases.NoValues.make({}), noValues(sourceOf(view.indicator)))
                  : Result.succeed(values),
              ),
            ),
            Effect.catchTag("TransformNotApplicable", ({ indicator, transform }) =>
              Effect.succeed(
                refuse(
                  Rejection.cases.NotApplicable.make({}),
                  `${indicator} is a percentage or rate; ${kindOf(transform)} does not apply to it.`,
                ),
              ),
            ),
          )

          return reported(fetched, {
            at,
            done: Result.match({
              onSuccess: ({ observations }) => at(Fetched.make({ values: observations.length })),
              onFailure: ({ reason }) => at(Rejected.make({ reason })),
            }),
          }).pipe(
            Effect.map(
              Result.match({
                onSuccess: (resolved) => {
                  const shown = Shown.make({ view: trim(resolved), data: summarize(resolved) })

                  return overlays === undefined ? shown : Struct.assign(shown, { overlays })
                },
                onFailure: ({ problem }) => rejected(problem),
              }),
            ),
          )
        }),
        Effect.catchTag("SchemaError", (error) => Effect.succeed(rejected(error.message))),
      )

    return Tools.of({
      search_indicators: ({ text, source }, { toolCallId }) => {
        const id = stepOf(toolCallId, "search_indicators")

        const at = (state: typeof Search.Type.state) =>
          source === null
            ? Search.make({ id, text, state })
            : Search.make({ id, text, source, state })

        return reported(catalog.search(text, { source: source ?? undefined }), {
          at,
          done: (entries) =>
            at(
              Searched.make({
                count: entries.length,
                top: entries.slice(0, 5).map(({ indicator, name }) => ({ indicator, name })),
              }),
            ),
        }).pipe(
          Effect.map((entries) =>
            entries.slice(0, 10).map(({ indicator, name, definition }) => ({
              indicator,
              source: sourceOf(indicator),
              name,
              definition: definition.slice(0, 300),
            })),
          ),
        )
      },
      // A code that is not an indicator's is the model's mistake, told to it
      // alone; one that names no indicator fails the step.
      // Notes the source cannot give now leave the definition alone.
      describe_indicator: ({ indicator, countries, dimensions }, { toolCallId }) =>
        Schema.decodeUnknownEffect(Described)({
          indicator,
          countries,
          dimensions: Object.fromEntries(
            (dimensions ?? []).map(({ dimension, code }) => [dimension, code]),
          ),
        }).pipe(
          Effect.flatMap((scope) => {
            const id = scope.indicator

            const at = (state: typeof Definition.Type.state) =>
              Definition.make({
                id: stepOf(toolCallId, "describe_indicator"),
                indicator: id,
                state,
              })

            const read = Effect.all(
              [
                sourceOf(id) === "World Bank" ? worldBank.describe(id) : sdmx.describe(id),
                notes.get(id, scope).pipe(Effect.orElseSucceed(() => null)),
              ],
              { concurrency: 2 },
            )

            return reported(read, {
              at,
              done: ([described]) => at(Read.make({ name: described.indicator.name })),
            })
          }),
          Effect.map(([described, written]) =>
            Defined.make({
              indicator: described.indicator.id,
              source: sourceOf(described.indicator.id),
              name: described.indicator.name,
              definition: described.indicator.definition,
              dataset: described.dataset,
              notes: written,
            }),
          ),
          Effect.catchTags({
            SchemaError: () => Effect.succeed(rejected(`${indicator} is not an indicator code.`)),
            IndicatorNotFound: () =>
              Effect.succeed(rejected(`There is no indicator ${indicator}. Search for one.`)),
          }),
        ),
      find_countries: ({ names }, { toolCallId }) => {
        const at = (state: typeof Lookup.Type.state) =>
          Lookup.make({ id: stepOf(toolCallId, "find_countries"), names, state })

        const places = names.map((name) => ({ name, countries: locate(name) }))

        return reported(Effect.succeed(places), {
          at,
          done: (found) =>
            at(
              Located.make({
                places: found.map(({ name, countries }) => ({
                  name,
                  countries: countries.map(({ code }) => code),
                })),
              }),
            ),
        }).pipe(
          Effect.map((found) =>
            found.map(({ name, countries }) => ({
              name,
              matches: countries.map((country) => ({ code: country.code, name: country.name })),
            })),
          ),
        )
      },
      // Countries or years that do not decode are the model's mistake, told
      // to it alone. Unavailable records fail the step, and the model
      // answers without them.
      find_politics: (span, { toolCallId }) =>
        Schema.decodeUnknownEffect(Span)(span).pipe(
          Effect.flatMap(({ countries, from, to }) => {
            const at = (state: typeof Records.Type.state) =>
              Records.make({ id: stepOf(toolCallId, "find_politics"), countries, from, to, state })

            return reported(politics.records({ countries, from, to }), {
              at,
              done: ({ governments, elections, events, reforms }) =>
                at(
                  Recorded.make({
                    governments: governments.length,
                    elections: elections.length,
                    events: events.length,
                    reforms: reforms.length,
                  }),
                ),
            }).pipe(
              Effect.tap((records) => know(citedIn(records))),
              Effect.map((records) => told(records, countries)),
            )
          }),
          Effect.catchTags({
            SchemaError: (error) => Effect.succeed(rejected(error.message)),
            PoliticsUnavailable: () =>
              Effect.succeed(
                rejected("Political records are unavailable now. Answer without them."),
              ),
          }),
        ),
      // Arguments that do not decode are the model's mistake, told to it
      // alone. No finding is an answer too: the research does not cover it.
      find_research: (asked, { toolCallId }) =>
        Schema.decodeUnknownEffect(Explaining)(asked).pipe(
          Effect.flatMap((query) => {
            const at = (state: typeof Research.Type.state) =>
              Research.make({ id: stepOf(toolCallId, "find_research"), ...query, state })

            return reported(research.covering(query), {
              at,
              done: (found) =>
                at(
                  Researched.make({
                    findings: found.map((finding) => ({
                      id: idOf(Cited.cases.Finding.make({ finding })),
                      name: finding.name,
                    })),
                  }),
                ),
            }).pipe(
              Effect.tap((found) =>
                know(found.map((finding) => Cited.cases.Finding.make({ finding }))),
              ),
              Effect.map(explained),
            )
          }),
          Effect.catchTag("SchemaError", (error) => Effect.succeed(rejected(error.message))),
        ),
      // Reads the recent years of the data the model named, the years a
      // cached source asks for at once (see `recent`), so show_chart, given
      // the same countries and series, reads its values from the cache.
      // Arguments that do not decode, and data the source cannot give, are
      // the model's mistakes, told to it as show_chart tells them. A country
      // without values is part of the answer.
      find_years: ({ indicator, countries, dimensions }, { toolCallId }) =>
        Effect.flatMap(recent, ({ from, to }) =>
          toView({
            chart: "trend",
            indicator,
            against: null,
            countries,
            from,
            to,
            year: null,
            span_from: null,
            span_to: null,
            transform: null,
            per: null,
            dimensions,
            overlays: null,
          }).pipe(
            Effect.flatMap((view) => {
              const at = (state: typeof Coverage.Type.state) =>
                Coverage.make({
                  id: stepOf(toolCallId, "find_years"),
                  indicator: view.indicator,
                  countries: view.countries,
                  state,
                })

              const covering = resolve(view).pipe(
                Effect.map(
                  Result.map(({ indicator: { name }, observations }) => ({
                    name,
                    ...coverage(observations, view.countries),
                  })),
                ),
                // find_years asks for no transform.
                Effect.catchTag("TransformNotApplicable", Effect.die),
              )

              return reported(covering, {
                at,
                done: Result.match({
                  onSuccess: (found) => at(Covered.make(Struct.omit(found, ["name"]))),
                  onFailure: ({ reason }) => at(Unresolved.make({ reason })),
                }),
              }).pipe(
                Effect.map(
                  Result.match({
                    onSuccess: (found) => Years.make({ ...found, from, to }),
                    onFailure: ({ problem }) => rejected(problem),
                  }),
                ),
              )
            }),
            Effect.catchTag("SchemaError", (error) => Effect.succeed(rejected(error.message))),
          ),
        ),
      // The question is shown when the round ends; see `answer`.
      ask_user: () =>
        Effect.succeed("The question is shown to the person. Their reply is the next message."),
      // Accepts only a View that decodes, that people can read, and that
      // resolves to at least one value. Mistakes go back to the model to
      // fix; an unreachable source fails the question. A View that does not
      // decode is the model's mistake, told to it alone; one the data cannot
      // show is reported with why.
      show_chart: (draft, { toolCallId }) => draw(draft, toolCallId),
    })
  }),
)

// A chat leaves tool arguments undecoded ("opaque"); results are decoded.
type Round = LanguageModel.GenerateTextResponse<Toolkit.Tools<typeof Tools>, "opaque">

// The question the agent asked the person in this round, if any.
const askedIn = (round: Round) =>
  Option.fromUndefinedOr(
    round.toolCalls.flatMap((call) => {
      if (call.name !== "ask_user" || !isAsk(call.params)) return []

      const [first, ...rest] = call.params.choices

      return first === undefined
        ? []
        : [Asked.make({ question: call.params.question, choices: [first, ...rest] })]
    })[0],
  )

// What the model wrote as a block, with the records it cites linked by name.
// Words that cite a record the agent did not look up are none.
const textOf = (written: string, known: ReadonlyMap<string, Cited>) =>
  Option.map(cite(written.trim(), known), ({ text, cites }) =>
    Arr.isReadonlyArrayNonEmpty(cites) ? Text.make({ text, cites }) : Text.make({ text }),
  )

// The blocks of this round, in order: what the model wrote, then each chart
// the data showed. A model writes before its tool calls, and their results
// follow them. Words that cannot be shown are none.
const blocksIn = (
  round: Round,
  known: ReadonlyMap<string, Cited>,
): ReadonlyArray<Option.Option<Block>> =>
  round.content.flatMap((part): ReadonlyArray<Option.Option<Block>> => {
    if (part.type === "text") return part.text.trim() === "" ? [] : [textOf(part.text, known)]

    if (part.type === "tool-result" && part.name === "show_chart" && !part.isFailure) {
      return isShown(part.result)
        ? [Option.some(Chart.make(Struct.omit(part.result, ["_tag", "data"])))]
        : []
    }

    return []
  })

// How the agent writes about a chart, in an answer and on its own.
const writing =
  "Write Markdown: short paragraphs, and a list or a small table only when it reads better than sentences. No headings, images, links or HTML. Say what the data shows: which way each country moves, which is highest or lowest, or how two indicators go together. Take numbers and years from the data, rounded if you like."

const instructions = (
  year: number,
) => `You answer a question about countries with data from the World Bank, Eurostat or the OECD. The answer is what you write and the charts you show, in that order: everything you write outside a tool call is shown to the person, between the charts. Write only what they should read, never what you are about to do.

Pick the source that fits the question when several measure the same thing:
- Eurostat when every country in the question is in the European Union.
- The OECD when every country is an OECD member and some are outside the European Union.
- The World Bank for worldwide comparisons, and whenever the source above has no indicator for what the question asks.
- The source the question names, if it names one.
A measure only one source publishes comes from that source.

1. Call search_indicators to find the indicator that measures what the question asks. Use only codes it returns; never write a code from memory. Pass a source to look in that source only, e.g. when its first results are another source's. When two results are close, call describe_indicator to read their definitions.
2. Pick the chart type as the section on chart types below says, and the countries.
   - Countries are ISO 3166-1 alpha-3 codes for every source. When a place name is not plainly one country, call find_countries. List the members of a group yourself, e.g. the G7 or the Nordic countries.
   - A Eurostat or OECD dataflow holds several series, e.g. by sex or age. find_years' and show_chart's rejections list its dimensions and their codes: pick the series the question asks for, else the total.
   - Charts show annual values. Prefer a Eurostat or OECD dataflow whose name does not say quarterly or monthly.
3. Unless the question names the years, call find_years with the indicator, the countries and the series before show_chart, and pick the years from what it returns. For a relation, call it for both indicators.
   - "shared" holds the years every country has a value in. A ranking, map or relation shows the latest of them. A change runs from the first year it would show, or the first shared year after it, to the latest shared year. A ranking, map or relation over time spans the same years as a change, and shows its last year unless the question names another.
   - A trend covers the last 20 years unless the question asks for others, and keeps them when a country's values start later: its line shows where data exists. It is ${year} now; most indicators have values up to ${year - 2}.
   - Years carried over from a chart you drew before are not named by the question.
4. Call show_chart with the chart type, the indicator, the countries, the series and the years. Pass the same countries and series as find_years, so the chart reads the values find_years fetched. Use a transform only when the question asks for one.
5. If find_years or show_chart rejects what you asked, fix what it names and call it again.
6. Once show_chart shows a chart, write about it from the data show_chart returned for it, never before. ${writing} For a chart over time, the data gives the values in its year and in the first and last years of its span: say how the comparison, or the two measures, moved between them. When you picked one source over others that measure the same thing, name it, e.g. "Eurostat's figures show". When you picked years other than those on screen or in the question, say why in one sentence, e.g. "Eurostat has data for all seven countries from 2009." Write as much as the question needs: most charts need two to four sentences.
7. If the question needs another chart, as the section on several charts below says, call find_years and show_chart for it. Otherwise stop calling tools: the answer is complete.

Chart types: each does one job. Pick the one that fits what the question asks, not the words it uses.
- trend: how a measure moved over time. "Has India caught up with China?" and "How did Poland's wages move in the 2010s?" are trends, and so is "How has unemployment moved across the EU since 2008?".
- ranking: how countries compare at one point in time. "Which G7 country has the most doctors per person?" is a ranking.
- map: the same comparison across a region or the world. "How do the 27 EU countries compare?" is a ranking or a map.
- ranking or map over time: how a comparison across countries evolved over years, with a slider through them. "How has the map of life expectancy in Africa changed since 1990?" is a map over time, and "How has the EU's ranking on debt evolved since 2010?" a ranking over time. Pass span_from and span_to only then; every other ranking or map shows one year, with both null. A question about how a measure moved in a few countries is a trend, and one about how much each country moved between two years is a change.
- change: how much each country moved between two years. "Which grew fastest since 2000?" is a change from 2000 to the latest year.
- relation: how one measure goes with another across countries, e.g. "Does more schooling go with higher incomes?". Search for the second indicator too.
- relation over time: how two measures moved together over years, each country's dot moving with a slider. "How have income and life expectancy moved together since 1990?" is a relation over time. Pass span_from and span_to only then; a relation of one year has both null.
Any chart type takes any number of countries: draw the countries the question asks about in the type that answers it.

Several charts: most answers need one chart. Show more only when one chart cannot show what the question asks:
- The question asks about measures with different units, e.g. "How have inflation and unemployment moved in Portugal?" is a trend of each.
- The question asks both how countries compare at one point and how they changed over time, e.g. "Which EU country has the highest debt, and how has that changed since 2010?" is a ranking, then a change.
One indicator for several countries is one chart, whatever the number of countries. "How does X go with Y?" is one relation chart, not a chart of each. You may write a sentence that ties the charts together after the last one.

Political context: a trend of EU and OECD members can show their elections, their governments, shaded by head of government, and major events, with pension reforms on pension charts. Use it only when the question asks about them, e.g. "under each president" or "since the last election" asks for governments or elections, "around the 2010 bailout" or "since the financial crisis" asks for events. Then call find_politics for the chart's countries and years, and pass the overlays the question asks for to show_chart. Never add context the question does not ask for.
To name a record find_politics returned, cite it by its id in double brackets, e.g. "Unemployment rose from 2008, the year the [[event:financial-crisis]] began." The record's name takes the id's place and links to its source: a government's is its head's name, an election's its year and ballot, e.g. "2017 presidential election". Never write the name of a head of government, party, election or event yourself, and cite only records find_politics returned.

Why a figure moved: give a cause only from a research finding find_research returned, never from what you know. When the question asks why, or your words would say what made a figure rise or fall, call find_research with the chart's indicator, countries and years before you write about the chart. Cite a finding by its id in double brackets, as you cite records, and write it as what research found, never as what the chart shows: "Studies of the euro crisis found [[finding:euro-crisis-multipliers]]." The finding's name takes the id's place and its card lists the studies. For a disputed finding, give both sides: its claim and its objection. For a finding of one study, say it rests on one study. When find_research returns no finding, say the research you have does not cover why. You may still describe the chart and cite events from find_politics, but state no cause.

Breaks in series and the sources' notes: show_chart's data lists under "flagged" each break in series the source marks, by country and year: the source changed how it measures from that year. When a chart you show crosses one, say so, naming the country, the year and the source, e.g. "Eurostat marks a break in series for Germany in 2020", so a change of method does not read as a change in the world. When a question asks why a line jumps, why two sources disagree, or how a figure is measured, call describe_indicator with the chart's indicator, countries and series before you write, and answer from the notes it returns, naming the source, e.g. "Eurostat's notes say". The notes say how the source measures a figure, never what made it move: give a cause only from find_research, as the paragraph above says. Quote no number the notes or the data do not give. If the notes do not explain it, say so instead of guessing.

If no indicator of any source measures what the question asks, say so in one sentence and stop without calling show_chart. A question only about politics, with no data to chart, e.g. "Who governed Spain in 2008?", is one of those: you answer with charts.

If the question can be read in ways that give different charts and none is a safe default, call ask_user instead of show_chart, with two to four short choices. Prefer a sensible default to asking: ask at most once per question.

A later question can follow up on your last answer, e.g. "add Chile" or "now per person". Apply it to the charts it names, or else to every chart it fits: "add Italy" adds Italy to each chart, "only since 2015" changes the years of every trend. Show each changed chart again, in the same order, keep the rest of each chart, and write about each one again. When a question starts with charts on screen, the person changed them since your last answer: follow up on those charts instead, by their place in the answer.`

export class Agent extends Context.Service<Agent, Interface>()("@civicdata/server/Agent") {
  // Needs a LanguageModel, a Catalog, a Resolver, a WorldBank, an Sdmx, the
  // political records and the research findings.
  static readonly layer = Layer.effect(
    Agent,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      const toolkit = yield* Tools
      const resolver = yield* Resolver

      const start = Effect.gen(function* () {
        const now = yield* DateTime.now

        return yield* Chat.fromPrompt([
          { role: "system", content: instructions(DateTime.getPartUtc(now, "year")) },
        ])
      })

      // Each round is one model request and the tools it calls. The round's
      // Thinking step runs while the model decides, and ends when a tool
      // reports its step or the model answers. Each tool reports its step as
      // it starts and as it ends, and each block of the round is sent once
      // the round ends.
      const answer = Effect.fn("Agent.answer")(function* (
        chat: Chat.Chat,
        { asked, queue }: { asked: Asking; queue: Queue.Queue<Step, Failure | Cause.Done> },
      ) {
        const send = (step: Step) => Effect.sync(() => Queue.offerUnsafe(queue, step))

        const thinking = yield* Ref.make(Option.none<StepId>())
        const known = yield* Ref.make<ReadonlyMap<string, Cited>>(new Map())

        // Ends the Thinking step, if one runs, in `state`.
        const think = (state: typeof Thinking.Type.state) =>
          Ref.getAndSet(thinking, Option.none()).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (id) => send(Thinking.make({ id, state })),
              }),
            ),
          )

        const report = Report.of((step) => think(Thought.make({})).pipe(Effect.andThen(send(step))))

        // The blocks of a round the answer can show. Words that cite a
        // record the agent did not look up are left out.
        const shown = Effect.fnUntraced(function* (response: Round) {
          const found = blocksIn(response, yield* Ref.get(known))

          if (found.some(Option.isNone)) {
            yield* Effect.logWarning("The model cited a record it did not look up")
          }

          return Arr.getSomes(found)
        })

        // The answer ends when the model stops calling tools or asks the
        // person which reading they mean. A question asked after the answer
        // has blocks is dropped, with what the model wrote beside it: the
        // blocks answer.
        const decided = Effect.gen(function* () {
          yield* Ref.update(chat.history, forget)

          const blocks: Array<Block> = []

          for (let round = 0; round < rounds; round += 1) {
            const id = StepId.make(`thinking-${round}`)

            yield* Ref.set(thinking, Option.some(id))
            yield* send(Thinking.make({ id, state: Running.make({}) }))

            const response = yield* chat.generateText({
              prompt: round === 0 ? prompted(asked) : [],
              toolkit,
            })

            yield* think(Thought.make({}))

            const question = askedIn(response)

            if (Option.isSome(question)) {
              if (blocks.length === 0) return question.value

              break
            }

            for (const block of yield* shown(response)) {
              yield* send(Rendered.make({ id: StepId.make(`block-${blocks.length}`), block }))

              blocks.push(block)
            }

            // The model answered in words alone: the answer is complete.
            if (response.toolCalls.length === 0) break
          }

          return Arr.isArrayNonEmpty(blocks) ? Answered.make({ blocks }) : Unanswered.make({})
        })

        yield* decided.pipe(
          Effect.flatMap(send),
          Effect.provideService(Report, report),
          Effect.provideService(Known, known),
          Effect.provideService(LanguageModel.LanguageModel, model),
          Effect.catchTag("AiError", (error) =>
            Effect.logWarning("Language model failed", error.reason).pipe(
              Effect.andThen(think(Failed.make({ reason: new AgentUnavailable() }))),
              Effect.andThen(Effect.fail(new AgentUnavailable())),
            ),
          ),
        )
      })

      const ask = (chat: Chat.Chat, asked: Asking) =>
        Stream.callback<Step, Failure>((queue) =>
          answer(chat, { asked, queue }).pipe(Effect.andThen(Queue.end(queue))),
        )

      // A model that writes nothing has not answered.
      const explain = Effect.fn("Agent.explain")(
        function* (view: View) {
          const data = summarize(yield* resolver.resolve(view))

          const response = yield* model.generateText({
            prompt: [
              {
                role: "system",
                content: `You say in two to four sentences what a chart of public data shows, given the chart and its data. ${writing}`,
              },
              { role: "user", content: JSON.stringify({ view, data }) },
            ],
          })

          const text = response.text.trim()

          if (text === "") {
            yield* Effect.logWarning("Language model explained a chart with no text")

            return yield* new AgentUnavailable()
          }

          return { view, text }
        },
        Effect.catchTag("AiError", (error) =>
          Effect.logWarning("Language model failed to explain a chart", error.reason).pipe(
            Effect.andThen(Effect.fail(new AgentUnavailable())),
          ),
        ),
      )

      return Agent.of({ start, ask, explain })
    }),
  ).pipe(Layer.provide(ToolsLayer))

  static readonly unavailable = Layer.succeed(
    Agent,
    Agent.of({
      start: Chat.empty,
      ask: () => Stream.fail(new AgentUnavailable()),
      explain: () => Effect.fail(new AgentUnavailable()),
    }),
  )

  // OpenAI, when the deployment has an OPENAI_API_KEY binding, with the
  // findings shipped in research/findings.json. Without a key (plain
  // `pnpm dev`, or a stage nobody gave a key) every question fails with
  // AgentUnavailable.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.OPENAI_API_KEY === undefined
          ? Agent.unavailable
          : Agent.layer.pipe(
              Layer.provide(Findings.layer),
              Layer.provide(OpenAiLanguageModel.model(env.OPENAI_MODEL ?? defaultModel)),
              Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(env.OPENAI_API_KEY) })),
              Layer.provide(FetchHttpClient.layer),
            ),
      ),
      Effect.orElseSucceed(() => Agent.unavailable),
    ),
  )
}
