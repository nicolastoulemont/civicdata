import { type Country, End, type Government, type Publisher } from "@civicdata/domain"
import { Schema } from "effect"

// What a trend chart can draw over its lines besides the data. Kept in the
// card and its link, not in the View: the agent's charts never set it.
export const Overlay = Schema.Literal("governments")

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

// How each archive asks to be cited. Both publish under CC0 1.0, which
// requires no credit; we cite them as they ask.
export const archives: Record<Exclude<Publisher, "Official">, { name: string; url: string }> = {
  PPEG: {
    name: "PPEG (Krause, Döring, Stoppe, WZB Berlin, 2025)",
    url: "https://doi.org/10.7910/DVN/5OAH7P",
  },
  ParlGov: { name: "ParlGov (Döring and Manow, 2024)", url: "https://doi.org/10.7910/DVN/2VZ5ZC" },
}

// The government, presidency and parliament pages that records checked by
// hand cite, each once.
export const officialPages = (governments: ReadonlyArray<Government>) => [
  ...new Set(
    governments.flatMap(({ citation }) =>
      citation.publisher === "Official" ? [citation.url] : [],
    ),
  ),
]
