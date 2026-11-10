import {
  type Country,
  type Definition,
  type Failed,
  type Fetch,
  type Lookup,
  type Recorded,
  type Records,
  type Rejection,
  type Search,
  type Source,
  sourceOf,
  type Step,
  type Takeaway,
  type Thinking,
  type Turn,
  transformOf,
  type Unchecked,
  type View,
} from "@civicdata/domain"
import { Match, Predicate } from "effect"
import {
  BookOpen,
  Brain,
  ChartLine,
  CircleStop,
  Landmark,
  type LucideIcon,
  MapPin,
  MessageCircleQuestion,
  PenLine,
  Search as SearchIcon,
  SearchX,
} from "lucide-react"

import { countryName, named, period } from "@/explore/format"

// A step a turn keeps: one that ended, or one saved before steps had states.
export type Saved = NonNullable<Turn["steps"]>[number]

// How a step stands. Only a running step's line moves.
type Status = "Running" | "Done" | "Failed" | "Stopped"

// One line of the work log: how its step stands, its icon, what it says, and
// what it opens to, if it has more to show.
export interface Line {
  readonly status: Status
  readonly icon: LucideIcon
  readonly text: string
  readonly more: ReadonlyArray<string>
}

const line = (
  status: Status,
  { icon, text, more = [] }: { icon: LucideIcon; text: string; more?: ReadonlyArray<string> },
): Line => ({ status, icon, text, more })

// A source in the middle of a sentence: "the World Bank", "Eurostat", "the OECD".
const of = (source: Source) => (source === "Eurostat" ? source : `the ${source}`)

// Why a step failed, in plain words.
const why = (reason: typeof Failed.Type.reason) =>
  Match.valueTags(reason, {
    SourceUnavailable: ({ source }) => `${of(source)} didn't answer`,
    CatalogUnavailable: () => "indicator search isn't available",
    PoliticsUnavailable: () => "political records aren't available",
    AgentUnavailable: () => "the assistant didn't answer",
    IndicatorNotFound: ({ indicator }) => `there is no indicator ${indicator}`,
  })

const failed = (
  reason: typeof Failed.Type.reason,
  { icon, text }: { icon: LucideIcon; text: string },
) => line("Failed", { icon, text: `${text}: ${why(reason)}` })

// A noun as a count takes it: one and many.
type Noun = readonly [one: string, many: string]

// "1 country", "3 countries".
const plural = (count: number, [one, many]: Noun) => `${count} ${count === 1 ? one : many}`

const thinking = ({ state }: typeof Thinking.Type) =>
  Match.valueTags(state, {
    Running: () => line("Running", { icon: Brain, text: "Thinking…" }),
    // The next step, or the answer, takes its place.
    Done: () => undefined,
    Failed: ({ reason }) => failed(reason, { icon: Brain, text: "Couldn't decide what to do" }),
    Stopped: () => line("Stopped", { icon: Brain, text: "Stopped thinking" }),
  })

const search = ({ text, source, state }: typeof Search.Type) => {
  const icon = SearchIcon
  const where = source === undefined ? "" : ` ${source}`

  return Match.valueTags(state, {
    Running: () => line("Running", { icon, text: `Searching${where} for “${text}”…` }),
    Done: ({ count, top }) =>
      line("Done", {
        icon,
        text: `Searched${where} for “${text}”: ${count === 0 ? "none" : count} found`,
        more: top.map(({ indicator, name }) => `${name} · ${sourceOf(indicator)}`),
      }),
    Failed: ({ reason }) => failed(reason, { icon, text: `Couldn't search for “${text}”` }),
    Stopped: () => line("Stopped", { icon, text: `Stopped searching for “${text}”` }),
  })
}

const definition = ({ state }: typeof Definition.Type) => {
  const icon = BookOpen

  return Match.valueTags(state, {
    Running: () => line("Running", { icon, text: "Reading the definition…" }),
    Done: ({ name }) => line("Done", { icon, text: `Read “${name}”` }),
    Failed: ({ reason }) => failed(reason, { icon, text: "Couldn't read the definition" }),
    Stopped: () => line("Stopped", { icon, text: "Stopped reading the definition" }),
  })
}

// Each place name and what it matched: "Côte d'Ivoire", or "“Korea” matched
// 2 places", or "nothing for “Atlantis”".
const found = (places: ReadonlyArray<{ name: string; countries: ReadonlyArray<Country> }>) =>
  places
    .map(({ name, countries: [first, ...rest] }) =>
      first === undefined
        ? `nothing for “${name}”`
        : rest.length === 0
          ? countryName(first)
          : `“${name}” matched ${rest.length + 1} places`,
    )
    .join(", ")

const lookup = ({ names, state }: typeof Lookup.Type) => {
  const icon = MapPin
  const asked = names.join(", ")

  return Match.valueTags(state, {
    Running: () => line("Running", { icon, text: `Looking up ${asked}…` }),
    // An ambiguous name opens to the places it may mean.
    Done: ({ places }) =>
      line("Done", {
        icon,
        text: `Found ${found(places)}`,
        more: places
          .filter(({ countries }) => countries.length > 1)
          .map(({ name, countries }) => `“${name}”: ${countries.map(countryName).join(", ")}`),
      }),
    Failed: ({ reason }) => failed(reason, { icon, text: `Couldn't look up ${asked}` }),
    Stopped: () => line("Stopped", { icon, text: `Stopped looking up ${asked}` }),
  })
}

// What a lookup's count of each kind of political record calls it.
const kinds = {
  governments: ["government", "governments"],
  elections: ["election", "elections"],
  events: ["event", "events"],
  reforms: ["reform", "reforms"],
} as const satisfies Record<string, Noun>

// "France", "France and Spain", "France, Spain and Italy".
const joined = (all: ReadonlyArray<string>) =>
  all.length < 2 ? all.join("") : `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`

// "France and Spain", or "4 countries" past three.
const countriesNamed = (countries: ReadonlyArray<Country>) =>
  countries.length > 3
    ? plural(countries.length, ["country", "countries"])
    : joined(countries.map(countryName))

// "4 governments and 2 elections", "1 government, 3 events and 1 reform".
const counted = (counts: typeof Recorded.Type) => {
  const each = (["governments", "elections", "events", "reforms"] as const).flatMap((kind) =>
    counts[kind] === 0 ? [] : [plural(counts[kind], kinds[kind])],
  )

  return each.length === 0 ? "no political records" : joined(each)
}

const records = ({ countries, from, to, state }: typeof Records.Type) => {
  const icon = Landmark
  const asked = `${countriesNamed(countries)}, ${from} to ${to}`

  return Match.valueTags(state, {
    Running: () => line("Running", { icon, text: `Looking up the political record of ${asked}…` }),
    Done: (counts) => line("Done", { icon, text: `Found ${counted(counts)} for ${asked}` }),
    Failed: ({ reason }) =>
      failed(reason, { icon, text: `Couldn't look up the political record of ${asked}` }),
    Stopped: () =>
      line("Stopped", { icon, text: `Stopped looking up the political record of ${asked}` }),
  })
}

// The chart type of a View, as a sentence names it: "a trend", "a map".
const typeOf = (view: View) =>
  Match.valueTags(view, {
    Trend: () => "a trend",
    Ranking: ({ as }) => (as === "Map" ? "a map" : "a ranking"),
    Change: () => "a change",
    Relation: () => "a relation",
  })

// Why the agent cannot show the chart it asked for, in plain words.
const rejected = (view: View, reason: Rejection) =>
  Match.valueTags(reason, {
    NoValues: () =>
      `${named(sourceOf(view.indicator))} has no values for ${
        view.countries.length === 1 ? countryName(view.countries[0]) : "these countries"
      } in ${period(view)}.`,
    NoIndicator: ({ indicator }) => `No source has the indicator ${indicator}.`,
    NotApplicable: () =>
      Match.value(transformOf(view)).pipe(
        Match.when("PerPerson", () => "Per person does not apply to this indicator."),
        Match.when("Growth", () => "Annual change does not apply to this indicator."),
        Match.when("Index", () => "An index does not apply to this indicator."),
        Match.orElse(() => "A ratio does not apply to this indicator."),
      ),
    OpenDimensions: ({ open }) =>
      `The data holds several series, and the chart has to pick one by ${open.join(", ")}.`,
    TooMany: ({ most }) =>
      `Too many countries for ${typeOf(view)}: ${view.countries.length}, at most ${most}.`,
    TooFew: ({ least }) =>
      `Too few countries for ${typeOf(view)}: ${view.countries.length}, at least ${least}.`,
  })

const retried = "Tried a chart the data can't show, trying again"

// The agent drew a chart people could not read, and draws another.
const redrawn = "Tried a chart that would be hard to read, trying again"

// What the work log says of a chart the agent tried and could not show.
const retrying = (reason: Rejection) =>
  Match.valueTags(reason, {
    NoValues: () => retried,
    NoIndicator: () => retried,
    NotApplicable: () => retried,
    OpenDimensions: () => retried,
    TooMany: () => redrawn,
    TooFew: () => redrawn,
  })

const fetch = ({ view, state }: typeof Fetch.Type) => {
  const icon = ChartLine
  const source = of(sourceOf(view.indicator))
  const countries = plural(view.countries.length, ["country", "countries"])

  return Match.valueTags(state, {
    Running: () =>
      line("Running", {
        icon,
        text: `Fetching ${source} data for ${countries}, ${period(view)}…`,
      }),
    Done: ({ values }) =>
      line("Done", { icon, text: `Got ${plural(values, ["value", "values"])} from ${source}` }),
    Rejected: ({ reason }) =>
      line("Done", { icon, text: retrying(reason), more: [rejected(view, reason)] }),
    Failed: ({ reason }) => failed(reason, { icon, text: `Couldn't fetch ${source} data` }),
    Stopped: () => line("Stopped", { icon, text: `Stopped fetching ${source} data` }),
  })
}

// Why the summary was left out. Summaries dropped before the check said why
// were dropped for a number.
const unchecked: Record<typeof Unchecked.Type, string> = {
  number: "it had a number that isn't in the data",
  name: "it named a government, party or event without citing its record",
  record: "it cited a record the assistant didn't look up",
  cause: "it said what caused a change in the data",
  empty: "the assistant wrote none",
}

const takeaway = ({ state }: typeof Takeaway.Type) => {
  const icon = PenLine

  return Match.valueTags(state, {
    Running: () => line("Running", { icon, text: "Writing the summary…" }),
    Done: ({ numbers }) =>
      line("Done", {
        icon,
        text:
          numbers === 0
            ? "Wrote the summary"
            : `Checked ${plural(numbers, ["number", "numbers"])} against the data`,
      }),
    Dropped: ({ reason = "number" }) =>
      line("Done", { icon, text: `Left out the summary: ${unchecked[reason]}` }),
    Failed: ({ reason }) => failed(reason, { icon, text: "Couldn't write the summary" }),
    Stopped: () => line("Stopped", { icon, text: "Stopped writing the summary" }),
  })
}

// "Searched Eurostat for “housing”: Eurostat", as searches saved before steps
// had states read. Older ones say only what was searched.
const searchedBefore = (
  text: string,
  {
    source,
    found: sources,
  }: { source?: Source | undefined; found?: ReadonlyArray<Source> | undefined },
) => {
  const asked = `Searched${source === undefined ? "" : ` ${source}`} for “${text}”`

  if (sources === undefined) return asked

  return `${asked}: ${sources.length === 0 ? "none found" : sources.join(", ")}`
}

// The line of a step, or none when it has nothing to say, as Thinking once
// the model decided.
export const lineOf = (step: Step | Saved): Line | undefined =>
  Match.valueTags(step, {
    Thinking: thinking,
    Search: search,
    Definition: definition,
    Lookup: lookup,
    Records: records,
    Fetch: fetch,
    Takeaway: takeaway,
    // A chart shows in the answer, not in the log.
    Drawn: () => undefined,
    Searched: ({ text, source, found: sources }) =>
      line("Done", { icon: SearchIcon, text: searchedBefore(text, { source, found: sources }) }),
    Described: ({ indicator }) =>
      line("Done", { icon: BookOpen, text: `Read the definition of ${indicator}` }),
    Located: ({ names }) => line("Done", { icon: MapPin, text: `Looked up ${names.join(", ")}` }),
    Rejected: ({ problem }) => line("Done", { icon: ChartLine, text: retried, more: [problem] }),
    Answered: ({ charts }) =>
      line("Done", {
        icon: ChartLine,
        text: charts.length === 1 ? "Found a chart" : `Found ${charts.length} charts`,
      }),
    Asked: () => line("Done", { icon: MessageCircleQuestion, text: "Asked which you mean" }),
    Unanswered: () => line("Done", { icon: SearchX, text: "Found no indicator" }),
    Stopped: () => line("Stopped", { icon: CircleStop, text: "Stopped" }),
  })

// The kinds of work the folded line counts.
const searches: Noun = ["search", "searches"]
const definitions: Noun = ["definition", "definitions"]
const lookups: Noun = ["lookup", "lookups"]
const charts: Noun = ["chart", "charts"]
const summaries: Noun = ["summary", "summaries"]

// The kind of work a step did. Only a chart the data could show counts as
// one: a chart tried and rejected, or cut off, is none.
const kindOf = (step: Saved): Noun | undefined =>
  Match.valueTags(step, {
    Search: () => searches,
    Searched: () => searches,
    Definition: () => definitions,
    Described: () => definitions,
    Lookup: () => lookups,
    Located: () => lookups,
    Records: () => lookups,
    Fetch: ({ state }) => (Predicate.isTagged(state, "Done") ? charts : undefined),
    Rejected: () => undefined,
    Takeaway: () => summaries,
  })

// The two kinds of work the agent did most, most first, a tie going to the
// kind it did first: "3 searches, 2 charts".
export const tally = (steps: ReadonlyArray<Saved>) => {
  const counts = new Map<Noun, number>()

  for (const kind of steps.map(kindOf)) {
    if (kind !== undefined) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }

  return [...counts]
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([kind, count]) => plural(count, kind))
    .join(", ")
}
