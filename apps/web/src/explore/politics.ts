import {
  type Ballot,
  bylineOf,
  Cited,
  type Citation,
  type Country,
  type Election,
  End,
  type Event,
  Evidence,
  type Finding,
  type Government,
  type Moment,
  type PartyColor,
  type Publisher,
  type Reform,
  Scope,
  type Study,
  When,
  yearOf,
  yearsOf,
} from "@repo/domain"
import { Array as Arr, Match } from "effect"
import type { TFunction } from "i18next"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { useFormat } from "./useFormat.ts"

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

const inYear = (government: Government, shown: number) =>
  year(government.start) <= shown &&
  End.match(government.end, {
    Next: ({ day }) => year(day) >= shown,
    Cutoff: ({ day }) => year(day) >= shown,
    Open: () => year(government.start) === shown,
  })

const roundYears = (election: Election) => [
  year(election.date),
  ...(election.lastRound === null ? [] : [year(election.lastRound)]),
]

// The years a country voted in, once each: where its markers go.
export const votedIn = (elections: ReadonlyArray<Election>, country: Country) => [
  ...new Set(elections.filter((election) => election.country === country).flatMap(roundYears)),
]

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

interface Dated {
  readonly date: Moment
  readonly approximate: boolean
}

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

// A page a record's card links to.
interface Page {
  readonly title: string
  readonly url: string
}

// A study as its card lists it: "Blanchard and Leigh (2013), Growth
// Forecast Errors and Fiscal Multipliers, IMF Working Paper WP/13/1".
const studied = (study: Study, side = ""): Page => ({
  title: `${side}${bylineOf(study)}, ${study.title}, ${study.publisher}`,
  url: study.url,
})

const describe = (t: TFunction<"explore">, format: ReturnType<typeof useFormat>) => {
  const { locale, countryName } = format

  // When the term ran, as the tooltip says it: "2011 to 2018". A head still in
  // office when the records end ran "2023 to at least 2025"; one with no
  // recorded end ran "from 2026".
  const when = (term: Term) => {
    const { from, to } = span(term)

    return End.match(final(term).end, {
      Next: () => t(($) => $["{{from}} to {{to}}"], { from: from, to: to }),
      Cutoff: () => t(($) => $["{{from}} to at least {{to}}"], { from: from, to: to }),
      Open: () => t(($) => $["from {{from}}"], { from: from }),
    })
  }

  // Who governed a country during a year, one line per head:
  // "Mariano Rajoy · PP · 2011 to 2018", with the parties of the governments
  // in office that year.
  const governing = (
    all: ReadonlyArray<Term>,
    { country, shown }: { country: Country; shown: number },
  ) =>
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
          parties.length === 0 ? t(($) => $["Parties not recorded"]) : parties.join(", "),
          when(term),
        ].join(" · "),
      ]
    })

  const ballotNames: Record<Ballot, string> = {
    parliament: t(($) => $["General election"]),
    president: t(($) => $["Presidential election"]),
    "president-indirect": t(($) => $["Indirect presidential election"]),
  }

  const longDate = (day: string) =>
    new Date(day).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })

  // A country's elections during a year, one line each:
  // "General election · 20 November 2011", or for one held in rounds
  // "Presidential election · 23 April 2017 and 7 May 2017".
  const voting = (
    elections: ReadonlyArray<Election>,
    { country, shown }: { country: Country; shown: number },
  ) =>
    elections.flatMap((election) =>
      election.country === country && roundYears(election).includes(shown)
        ? [
            [
              ballotNames[election.ballot],
              election.lastRound === null
                ? longDate(election.date)
                : t(($) => $["{{value1}} and {{value2}}"], {
                    value1: longDate(election.date),
                    value2: longDate(election.lastRound),
                  }),
            ].join(" · "),
          ]
        : [],
    )

  // A moment as precise as its source: "1973", "May 2010", "3 October 1990".
  const spoken = (moment: Moment) =>
    Match.value(moment.length).pipe(
      Match.when(4, () => moment),
      Match.when(7, () =>
        new Date(`${moment}-01`).toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }),
      ),
      Match.orElse(() => longDate(moment)),
    )

  const dated = ({ date, approximate }: Dated) =>
    `${approximate ? t(($) => $["about "]) : ""}${spoken(date)}`

  // When an event happened, as the tooltip says it: "3 October 1990", "about
  // 1973 to about 1975", or "since 24 February 2022" for one still going on.
  const whenSaid = (happened: When) =>
    When.match(happened, {
      Point: ({ at }) => dated(at),
      Period: ({ from, to }) =>
        to === null
          ? t(($) => $["since {{value1}}"], { value1: dated(from) })
          : t(($) => $["{{value1}} to {{value2}}"], { value1: dated(from), value2: dated(to) }),
    })

  // Who an event concerns, named for a chart of some countries: "Worldwide",
  // "Today's 27 EU members", a few countries by name, or how many with the
  // chart's among them.
  const concerned = (scope: Scope, shown: ReadonlyArray<Country>) =>
    Scope.match(scope, {
      World: () => t(($) => $["Worldwide"]),
      Countries: ({ countries }) => {
        if (countries.length === eu.size && countries.every((country) => eu.has(country)))
          return t(($) => $["Today's 27 EU members"])

        if (countries.length <= 3) return countries.map(countryName).join(", ")

        const among = shown.flatMap((country) =>
          countries.includes(country) ? [countryName(country)] : [],
        )

        return among.length === 0
          ? t(($) => $["{{value1}} countries"], { value1: countries.length })
          : t(($) => $["{{value1}} countries, including {{value2}}"], {
              value1: countries.length,
              value2: new Intl.ListFormat(locale).format(among),
            })
      },
    })

  // "Sources 2 and 3 below": where the source line links a record's sources.
  const sourcesOf = (record: Event | Reform, pages: Pages) => {
    const numbers = record.sources.map(
      (source) => pages.findIndex((page) => page.url === source.url) + 1,
    )

    return t(($) => $["{{value1}} {{value2}} below"], {
      value1: numbers.length === 1 ? t(($) => $["Source"]) : t(($) => $["Sources"]),
      value2: new Intl.ListFormat(locale).format(numbers.map(String)),
    })
  }

  // The events of a year on a chart of some countries, one line each:
  // "German reunification · 3 October 1990 · Germany · Reunification extended
  // ... · Source 1 below". Each says what happened, never what it did to the
  // line. A period that started in an earlier year gives its name and dates
  // only, "COVID-19 emergency · 2020 to May 2023", so a year inside several
  // stays short; the year it started gives the rest.
  const happening = (
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
    adopted: t(($) => $["Adopted"]),
    "in-force": t(($) => $["In force"]),
  }

  // A country's reforms of a year, one line each: "Woerth reform · Adopted 9
  // November 2010 · The minimum pension age rose ... · Source 4 below".
  const reformed = (
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

  // The file or page an archived or official record was read from.
  const read = ({ publisher, url }: Citation): Page => ({
    title: publisher === "Official" ? t(($) => $["Official record"]) : archives[publisher].name,
    url,
  })

  // How settled a finding is, as its card says it.
  const standing = (evidence: Evidence) =>
    Evidence.match(evidence, {
      Agreed: ({ studies }) =>
        t(($) => $["Agreed: {{value1}} studies support it, and none we hold disputes it"], {
          value1: studies.length,
        }),
      Single: () => t(($) => $["One study: not yet replicated"]),
      Disputed: ({ objection }) => t(($) => $["Disputed: {{objection}}"], { objection: objection }),
    })

  // The studies of a finding, each side of a dispute named.
  const papers = (evidence: Evidence): Arr.NonEmptyReadonlyArray<Page> =>
    Evidence.match(evidence, {
      Agreed: ({ studies }) => Arr.map(studies, (study) => studied(study)),
      Single: ({ study }) => Arr.of(studied(study)),
      Disputed: ({ supporting, disputing }) =>
        Arr.appendAll(
          Arr.map(supporting, (study) =>
            studied(
              study,
              t(($) => $["Supports: "]),
            ),
          ),
          Arr.map(disputing, (study) =>
            studied(
              study,
              t(($) => $["Disputes: "]),
            ),
          ),
        ),
    })

  // A finding's lines: its claim, where and when it holds, and how settled it
  // is.
  const explaining = (finding: Finding, countries: ReadonlyArray<Country>) => [
    finding.claim,
    `${concerned(finding.scope, countries)} · ${
      finding.from === finding.to
        ? finding.from
        : t(($) => $["{{value1}} to {{value2}}"], { value1: finding.from, value2: finding.to })
    }`,
    standing(finding.evidence),
  ]

  // What the card of a record the agent's words cite shows, as the chart's
  // tooltip says it for the year the record starts: its line, the pages it
  // cites, numbered as its line refers to them, and the page its name links to.
  const card = (record: Cited, countries: ReadonlyArray<Country>) =>
    Cited.match(record, {
      Government: ({ government }) => ({
        lines: governing(terms([government]), {
          country: government.country,
          shown: year(government.start),
        }),
        pages: [read(government.citation)],
        link: government.citation.url,
      }),
      Election: ({ election }) => ({
        lines: voting([election], { country: election.country, shown: year(election.date) }),
        pages: [read(election.citation)],
        link: election.citation.url,
      }),
      Event: ({ event }) => {
        const pages = cited([event])

        return {
          lines: happening([event], { countries, shown: yearsOf(event.when).from, pages }),
          pages,
          link: event.sources[0].url,
        }
      },
      Reform: ({ reform }) => {
        const pages = cited([reform])

        return {
          lines: reformed([reform], { country: reform.country, shown: yearOf(reform.date), pages }),
          pages,
          link: reform.sources[0].url,
        }
      },
      Finding: ({ finding }) => {
        const pages = papers(finding.evidence)

        return { lines: explaining(finding, countries), pages, link: pages[0].url }
      },
    })

  return { governing, voting, happening, reformed, card }
}

export const usePolitics = () => {
  const { t } = useTranslation("explore")
  const format = useFormat()

  return useMemo(() => describe(t, format), [t, format])
}
