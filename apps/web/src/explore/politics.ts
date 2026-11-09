import {
  type Ballot,
  type Country,
  type Election,
  End,
  type Event,
  type Government,
  type Moment,
  type PartyColor,
  type Publisher,
  type Reform,
  Scope,
  When,
  yearOf,
  yearsOf,
} from "@civicdata/domain"
import { Match, Schema } from "effect"

import { countryName } from "./format.ts"

// What a trend chart can draw over its lines besides the data. Kept in the
// card and its link, not in the View: the agent's charts never set it.
export const Overlay = Schema.Literals(["elections", "governments", "events"])

export type Overlay = typeof Overlay.Type

// One head of government's time in office: their consecutive governments in
// one country, e.g. Mariano Rajoy's three cabinets from 2011 to 2018.
export interface Term {
  readonly country: Country
  readonly head: string
  readonly governments: readonly [Government, ...Array<Government>]
}

export const terms = (governments: ReadonlyArray<Government>): ReadonlyArray<Term> =>
  governments.reduce<Array<Term>>((all, government) => {
    const last = all.at(-1)

    if (last?.country === government.country && last.head === government.head) {
      all[all.length - 1] = { ...last, governments: [...last.governments, government] }
    } else {
      all.push({ country: government.country, head: government.head, governments: [government] })
    }

    return all
  }, [])

const year = (day: string) => Number(day.slice(0, 4))

// The colour a term's band takes: its head's party's, when every government
// of the term has that one colour; none otherwise.
export const tint = ({ governments: [first, ...rest] }: Term): PartyColor | null => {
  const color = first.color

  return color !== null && rest.every((government) => government.color?.hex === color.hex)
    ? color
    : null
}

// The colours of some terms' bands, each page that sets one once.
export const tints = (all: ReadonlyArray<Term>) => [
  ...new Map(
    all.flatMap((term) => {
      const color = tint(term)

      return color === null ? [] : [[color.url, color] as const]
    }),
  ).values(),
]

const first = (term: Term) => term.governments[0]

const final = (term: Term) => term.governments.at(-1) ?? first(term)

// The years a term spans: from its start to its end, or to its publisher's
// cutoff for a head still in office then. A term with no recorded end spans
// its first year only.
export const span = (term: Term) => {
  const from = year(first(term).start)
  const { end } = final(term)

  return {
    from,
    to: End.match(end, {
      Next: ({ day }) => year(day),
      Cutoff: ({ day }) => year(day),
      Open: () => from,
    }),
  }
}

// When the term ran, as the tooltip says it: "2011 to 2018". A head still in
// office when the records end ran "2023 to at least 2025"; one with no
// recorded end ran "from 2026".
const when = (term: Term) => {
  const { from, to } = span(term)

  return End.match(final(term).end, {
    Next: () => `${from} to ${to}`,
    Cutoff: () => `${from} to at least ${to}`,
    Open: () => `from ${from}`,
  })
}

const inYear = (government: Government, shown: number) =>
  year(government.start) <= shown &&
  End.match(government.end, {
    Next: ({ day }) => year(day) >= shown,
    Cutoff: ({ day }) => year(day) >= shown,
    Open: () => year(government.start) === shown,
  })

// Who governed a country during a year, one line per head:
// "Mariano Rajoy · PP · 2011 to 2018", with the parties of the governments
// in office that year.
export const governing = (all: ReadonlyArray<Term>, country: Country, shown: number) =>
  all.flatMap((term) => {
    const during = term.governments.filter((government) => inYear(government, shown))

    if (term.country !== country || during.length === 0) return []

    const parties = [
      ...new Set(
        during.flatMap((government) =>
          government.parties.map((party) => party.abbreviation ?? party.name),
        ),
      ),
    ]

    return [
      [
        term.head,
        parties.length === 0 ? "Parties not recorded" : parties.join(", "),
        when(term),
      ].join(" · "),
    ]
  })

// What each election chose, as a reader would put it.
const ballotNames: Record<Ballot, string> = {
  parliament: "General election",
  president: "Presidential election",
  "president-indirect": "Indirect presidential election",
}

const longDate = (day: string) =>
  new Date(day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

const roundYears = (election: Election) => [
  year(election.date),
  ...(election.lastRound === null ? [] : [year(election.lastRound)]),
]

// The years a country voted in, once each: where its markers go.
export const votedIn = (elections: ReadonlyArray<Election>, country: Country) => [
  ...new Set(elections.filter((election) => election.country === country).flatMap(roundYears)),
]

// A country's elections during a year, one line each:
// "General election · 20 November 2011", or for one held in rounds
// "Presidential election · 23 April 2017 and 7 May 2017".
export const voting = (elections: ReadonlyArray<Election>, country: Country, shown: number) =>
  elections.flatMap((election) =>
    election.country === country && roundYears(election).includes(shown)
      ? [
          [
            ballotNames[election.ballot],
            election.lastRound === null
              ? longDate(election.date)
              : `${longDate(election.date)} and ${longDate(election.lastRound)}`,
          ].join(" · "),
        ]
      : [],
  )

// How each archive asks to be cited. Both publish under CC0 1.0, which
// requires no credit; we cite them as they ask.
export const archives: Record<Exclude<Publisher, "Official">, { name: string; url: string }> = {
  PPEG: {
    name: "PPEG (Krause, Döring, Stoppe, WZB Berlin, 2025)",
    url: "https://doi.org/10.7910/DVN/5OAH7P",
  },
  ParlGov: { name: "ParlGov (Döring and Manow, 2024)", url: "https://doi.org/10.7910/DVN/2VZ5ZC" },
}

// The government, presidency, parliament and electoral authority pages that
// records checked by hand cite, each once.
export const officialPages = (records: ReadonlyArray<Government | Election>) => [
  ...new Set(
    records.flatMap(({ citation }) => (citation.publisher === "Official" ? [citation.url] : [])),
  ),
]

// Today's 27 EU members: the countries most events concern.
const eu = new Set<Country>([
  "AUT",
  "BEL",
  "BGR",
  "HRV",
  "CYP",
  "CZE",
  "DNK",
  "EST",
  "FIN",
  "FRA",
  "DEU",
  "GRC",
  "HUN",
  "IRL",
  "ITA",
  "LVA",
  "LTU",
  "LUX",
  "MLT",
  "NLD",
  "POL",
  "PRT",
  "ROU",
  "SVK",
  "SVN",
  "ESP",
  "SWE",
])

// A moment as precise as its source: "1973", "May 2010", "3 October 1990".
const spoken = (moment: Moment) =>
  Match.value(moment.length).pipe(
    Match.when(4, () => moment),
    Match.when(7, () =>
      new Date(`${moment}-01`).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    ),
    Match.orElse(() => longDate(moment)),
  )

interface Dated {
  readonly date: Moment
  readonly approximate: boolean
}

const dated = ({ date, approximate }: Dated) => `${approximate ? "about " : ""}${spoken(date)}`

// When an event happened, as the tooltip says it: "3 October 1990", "about
// 1973 to about 1975", or "since 24 February 2022" for one still going on.
const whenSaid = (happened: When) =>
  When.match(happened, {
    Point: ({ at }) => dated(at),
    Period: ({ from, to }) =>
      to === null ? `since ${dated(from)}` : `${dated(from)} to ${dated(to)}`,
  })

// Who an event concerns, named for a chart of some countries: "Worldwide",
// "Today's 27 EU members", a few countries by name, or how many with the
// chart's among them.
const concerned = (scope: Scope, shown: ReadonlyArray<Country>) =>
  Scope.match(scope, {
    World: () => "Worldwide",
    Countries: ({ countries }) => {
      if (countries.length === eu.size && countries.every((country) => eu.has(country)))
        return "Today's 27 EU members"

      if (countries.length <= 3) return countries.map(countryName).join(", ")

      const among = shown.flatMap((country) =>
        countries.includes(country) ? [countryName(country)] : [],
      )

      return `${countries.length} countries, including ${among.join(" and ")}`
    },
  })

// The years each event spans that a chart of years up to `last` shows: one
// still going on runs to the chart's end.
export const spanOf = (event: Event, last: number) => {
  const { from, to } = yearsOf(event.when)

  return { from, to: to ?? last }
}

// The source pages of the events and reforms on a chart, each once, in the
// order the card's source line numbers them.
export const cited = (records: ReadonlyArray<Event | Reform>) => [
  ...new Map(
    records.flatMap(({ sources }) => sources).map((source) => [source.url, source] as const),
  ).values(),
]

type Pages = ReturnType<typeof cited>

// "Sources 2 and 3 below": where the source line links a record's sources.
const sourcesOf = (record: Event | Reform, pages: Pages) => {
  const numbers = record.sources.map(
    (source) => pages.findIndex((page) => page.url === source.url) + 1,
  )

  return `${numbers.length === 1 ? "Source" : "Sources"} ${numbers.join(" and ")} below`
}

// The events of a year on a chart of some countries, one line each:
// "German reunification · 3 October 1990 · Germany · Reunification extended
// ... · Source 1 below". Each says what happened, never what it did to the
// line. A period that started in an earlier year gives its name and dates
// only, "COVID-19 emergency · 2020 to May 2023", so a year inside several
// stays short; the year it started gives the rest.
export const happening = (
  events: ReadonlyArray<Event>,
  { countries, shown, pages }: { countries: ReadonlyArray<Country>; shown: number; pages: Pages },
) =>
  events.flatMap((event) => {
    const { from, to } = spanOf(event, shown)

    if (shown < from || shown > to) return []

    return [
      (shown === from
        ? [
            event.name,
            whenSaid(event.when),
            concerned(event.scope, countries),
            event.summary,
            sourcesOf(event, pages),
          ]
        : [event.name, whenSaid(event.when)]
      ).join(" · "),
    ]
  })

const milestones: Record<Reform["milestone"], string> = {
  adopted: "Adopted",
  "in-force": "In force",
}

// A country's reforms of a year, one line each: "Woerth reform · Adopted 9
// November 2010 · The minimum pension age rose ... · Source 4 below".
export const reformed = (
  reforms: ReadonlyArray<Reform>,
  { country, shown, pages }: { country: Country; shown: number; pages: Pages },
) =>
  reforms.flatMap((reform) =>
    reform.country === country && yearOf(reform.date) === shown
      ? [
          [
            reform.name,
            `${milestones[reform.milestone]} ${spoken(reform.date)}`,
            reform.summary,
            sourcesOf(reform, pages),
          ].join(" · "),
        ]
      : [],
  )
