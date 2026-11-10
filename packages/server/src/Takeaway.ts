import {
  type Cite,
  type Cited,
  Country,
  nameOf,
  type Observation,
  type Politics,
  type ResolvedView,
  type Unchecked,
  Year,
} from "@civicdata/domain"
import { Array as Arr, Match, Order, Predicate, Result, Schema } from "effect"

const Point = Schema.Struct({ year: Year, value: Schema.Finite })

type Point = typeof Point.Type

// Where one line of a trend or a change starts, ends, and is lowest and
// highest.
const Line = Schema.Struct({
  country: Country,
  first: Point,
  last: Point,
  lowest: Point,
  highest: Point,
})

const Lines = Schema.TaggedStruct("Lines", {
  name: Schema.String,
  from: Year,
  to: Year,
  lines: Schema.Array(Line),
  missing: Schema.Array(Country),
})

// A ranking's values, highest first.
const Bars = Schema.TaggedStruct("Bars", {
  name: Schema.String,
  year: Year,
  bars: Schema.Array(Schema.Struct({ country: Country, value: Schema.Finite })),
  missing: Schema.Array(Country),
})

// A relation's dots: each country's value of the indicator and of the one it
// is plotted against, named in `against`.
const Dots = Schema.TaggedStruct("Dots", {
  name: Schema.String,
  against: Schema.String,
  year: Year,
  dots: Schema.Array(
    Schema.Struct({ country: Country, value: Schema.Finite, against: Schema.Finite }),
  ),
  missing: Schema.Array(Country),
})

// What show_chart tells the model about the values it charted, so it can
// write a takeaway: the indicator's official name, which carries its unit,
// the years the chart covers, and a trend's or a change's lines, a ranking's
// bars, or a relation's dots. `missing` lists the countries the chart has no
// value for.
export const Summary = Schema.Union([Lines, Bars, Dots])

export type Summary = typeof Summary.Type

const byYear = Order.mapInput(Order.Number, (observation: Observation) => observation.year)
const byValue = Order.mapInput(Order.Number, (observation: Observation) => observation.value)

const pointOf = ({ year, value }: Observation): Point => ({ year, value })

const lineOf = (observations: Arr.NonEmptyReadonlyArray<Observation>) => ({
  country: observations[0].country,
  first: pointOf(Arr.min(observations, byYear)),
  last: pointOf(Arr.max(observations, byYear)),
  lowest: pointOf(Arr.min(observations, byValue)),
  highest: pointOf(Arr.max(observations, byValue)),
})

const lines = (
  { indicator, observations, missing }: ResolvedView,
  { from, to }: { readonly from: Year; readonly to: Year },
) =>
  Lines.make({
    name: indicator.name,
    from,
    to,
    lines: Object.values(Arr.groupBy(observations, (observation) => observation.country)).map(
      lineOf,
    ),
    missing,
  })

const bars = ({ indicator, observations, missing }: ResolvedView, year: Year) =>
  Bars.make({
    name: indicator.name,
    year,
    bars: Arr.sort(observations, Order.flip(byValue)).map(({ country, value }) => ({
      country,
      value,
    })),
    missing,
  })

// Only a relation holds the values it is plotted against.
export const summarize = (resolved: ResolvedView): Summary =>
  "against" in resolved
    ? Dots.make({
        name: resolved.indicator.name,
        against: resolved.against.indicator.name,
        year: resolved.view.year,
        dots: resolved.observations.flatMap(({ country, value }) =>
          resolved.against.observations
            .filter((other) => other.country === country)
            .map((other) => ({ country, value, against: other.value })),
        ),
        missing: resolved.missing,
      })
    : Match.valueTags(resolved.view, {
        Trend: (trend) => lines(resolved, trend),
        Change: (change) => lines(resolved, change),
        Ranking: ({ year }) => bars(resolved, year),
      })

// How a takeaway is written, for the agent's instructions and for explaining
// a chart on its own.
export const rules =
  "two short sentences of plain text, without Markdown, on what the chart shows, read from its data. Say which way each country moves, which is highest or lowest, or how the two indicators go together. Take every number and year from that data, rounded if you like; never work one out, such as a difference, a ratio or an average. Never write the name of a head of government, a party, an election or an event yourself, and never say what caused a movement in the data."

// Words that say one thing caused another. A takeaway says what the data
// shows beside the political records, never why it moved: "rose from 2008,
// the year of the financial crisis", not "rose because of the crisis".
export const causal: ReadonlyArray<string> = [
  "because",
  "due to",
  "led to",
  "leading to",
  "caused",
  "causing",
  "thanks to",
  "as a result of",
  "resulted in",
  "owing to",
  "triggered",
  "driven by",
]

// A number as a takeaway writes it, e.g. "72", "1,234.5" or "2.1 trillion".
// Digits inside a word, as in "G7" or "CO2", are part of a name, not a number.
const numbers =
  /(?<![\p{L}\p{N}.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(thousand|million|billion|bn|trillion|tn)\b)?(?![\p{L}\p{N}])/giu

const scales = new Map([
  ["thousand", 1e3],
  ["million", 1e6],
  ["billion", 1e9],
  ["bn", 1e9],
  ["trillion", 1e12],
  ["tn", 1e12],
])

interface Written {
  readonly text: string
  readonly value: number
  // How far the written value may be from the data it rounds: half its last digit.
  readonly tolerance: number
}

const writtenIn = (text: string): ReadonlyArray<Written> =>
  Array.from(text.matchAll(numbers), ([match, whole = "", decimals = "", scale = ""]) => {
    const unit = scales.get(scale.toLowerCase()) ?? 1

    return {
      text: match,
      value: Number(`${whole.replaceAll(",", "")}.${decimals}0`) * unit,
      tolerance: 0.5 * 10 ** -decimals.length * unit,
    }
  })

const valuesOf = (summary: Summary) =>
  Match.valueTags(summary, {
    Lines: ({ lines: each }) =>
      each.flatMap((line) => [line.first, line.last, line.lowest, line.highest]),
    Bars: ({ bars: each, year }) => each.map(({ value }) => ({ year, value })),
    Dots: ({ dots, year }) =>
      dots.flatMap(({ value, against }) => [
        { year, value },
        { year, value: against },
      ]),
  })

const yearsOf = (summary: Summary) =>
  Match.valueTags(summary, {
    Lines: ({ from, to }) => [from, to],
    Bars: ({ year }) => [year],
    Dots: ({ year }) => [year],
  })

const namesOf = (summary: Summary) =>
  Match.valueTags(summary, {
    Lines: ({ name }) => [name],
    Bars: ({ name }) => [name],
    Dots: ({ name, against }) => [name, against],
  })

// Whether a written number comes from the data: a value or a year in the
// summary, rounded the way it is written, or a number in an indicator's name,
// such as the ages in "Unemployment, youth total (% of labor force ages 15-24)".
// A sign is not checked: "fell 3.2%" writes the value -3.2.
const fromData = (summary: Summary) => {
  const points = valuesOf(summary)
  const years = new Set<number>([...yearsOf(summary), ...points.map(({ year }) => year)])

  const named = new Set(
    namesOf(summary)
      .flatMap(writtenIn)
      .map(({ text }) => text),
  )

  return ({ text, value, tolerance }: Written) =>
    named.has(text) ||
    years.has(value) ||
    points.some((point) => Math.abs(Math.abs(point.value) - value) <= tolerance * (1 + 1e-9))
}

// A phrase as a whole word or words in a text: "Rutte" is not in "Ruttel".
const phrase = (text: string, { cased }: { readonly cased: boolean }) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${text.replaceAll(/[$()*+./?[\\\]^{|}]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    cased ? "u" : "iu",
  )

const causes = causal.map((words) => phrase(words, { cased: false }))

// Months, which a surname can also be: Theresa May.
const months = new Set([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
])

// What a takeaway might write of a head of government: their name, or their
// surname alone when it is long enough not to be a common word.
const headNames = (head: string) => {
  const surname = head.split(/\s+/).at(-1) ?? head

  return surname !== head && surname.length >= 4 && !months.has(surname) ? [head, surname] : [head]
}

// The names in some political records, as patterns a takeaway's text could
// match: each head of government, each governing party by name and by an
// abbreviation of two letters or more, each event by its name and by the
// name before its colon ("Maastricht Treaty: signature"), and each reform.
// People and parties match as written; events and reforms in any case.
export const namesIn = ({ governments, events, reforms }: Politics): ReadonlyArray<RegExp> => {
  const people = governments.flatMap(({ head, parties }) => [
    ...headNames(head),
    ...parties.flatMap(({ name, abbreviation }) =>
      abbreviation === null || abbreviation.length < 2 ? [name] : [name, abbreviation],
    ),
  ])

  const happened = [
    ...events.flatMap(({ name }) => [name, name.split(":")[0]?.trim() ?? name]),
    ...reforms.map(({ name }) => name),
  ]

  return [
    ...[...new Set(people)].map((name) => phrase(name, { cased: true })),
    ...[...new Set(happened)].map((name) => phrase(name, { cased: false })),
  ]
}

// A takeaway that passed the check, as people read it: its text with each
// cited record's name in place of its id, how many numbers it has, each
// checked, and the records it cites.
interface Checked {
  readonly text: string
  readonly numbers: number
  readonly cites: ReadonlyArray<typeof Cite.Type>
}

// What a takeaway is checked against: the data the model was given, the
// names in the political records of the chart's countries, and the records
// the agent looked up, by id: the only ones it can cite.
interface Against {
  readonly summary: Summary
  readonly names: ReadonlyArray<RegExp>
  readonly records: ReadonlyMap<string, Cited>
}

// A citation as the model writes it: a record's id in double brackets,
// "[[event:financial-crisis]]".
const citation = /\[\[\s*([^\]\s]+)\s*\]\]/g

// The model's words and the records it cites between them, in order, or
// none when it cites a record the agent did not look up.
const partsOf = (takeaway: string, records: ReadonlyMap<string, Cited>) => {
  const parts: Array<string | Cited> = []
  let from = 0

  for (const { 0: whole, 1: id = "", index } of takeaway.matchAll(citation)) {
    const record = records.get(id)

    if (record === undefined) return undefined

    parts.push(takeaway.slice(from, index), record)
    from = index + whole.length
  }

  parts.push(takeaway.slice(from))

  return parts
}

// The takeaway as people read it: each cited record's name where the model
// wrote its id, and where each name starts.
const rendered = (parts: ReadonlyArray<string | Cited>) =>
  parts.reduce<{ text: string; cites: Array<typeof Cite.Type> }>(
    ({ text, cites }, part) =>
      Predicate.isString(part)
        ? { text: `${text}${part}`, cites }
        : { text: `${text}${nameOf(part)}`, cites: [...cites, { at: text.length, record: part }] },
    { text: "", cites: [] },
  )

// The takeaway to show from what the model wrote, or why it is not shown.
// Every number in the model's own words must come from the data it was
// given; a takeaway with any other number, such as a difference the model
// worked out, is not shown. Nor is one that cites a record the agent did not
// look up, names a head of government, party or event from the political
// records instead of citing it, or says what caused a movement in the data.
// The answer shows plain text, so Markdown bold, which models write anyway,
// is removed.
export const check = (
  text: string,
  { summary, names, records }: Against,
): Result.Result<Checked, typeof Unchecked.Type> => {
  const takeaway = text.replaceAll("**", "").trim()

  if (takeaway === "") return Result.fail("empty")

  const parts = partsOf(takeaway, records)

  if (parts === undefined) return Result.fail("record")

  const words = parts.filter(Predicate.isString)
  const written = words.flatMap(writtenIn)

  if (!written.every(fromData(summary))) return Result.fail("number")

  if (words.some((each) => names.some((name) => name.test(each)))) return Result.fail("name")

  if (causes.some((cause) => cause.test(words.join(" ")))) return Result.fail("cause")

  return Result.succeed({ ...rendered(parts), numbers: written.length })
}
