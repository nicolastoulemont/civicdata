import {
  chartsOf,
  type Country,
  type Coverage,
  type Covered,
  type Definition,
  type Failed,
  type Fetch,
  type Lookup,
  type Recorded,
  type Records,
  type Rejection,
  type Research,
  type Search,
  type Source,
  sourceOf,
  type Step,
  type Thinking,
  type Turn,
  transformOf,
  type Unresolved,
  type View,
} from "@civicdata/domain"
import { Match, Predicate } from "effect"
import type { TFunction } from "i18next"
import {
  BookOpen,
  Brain,
  CalendarRange,
  ChartLine,
  CircleStop,
  GraduationCap,
  Landmark,
  type LucideIcon,
  MapPin,
  MessageCircleQuestion,
  Search as SearchIcon,
  SearchX,
} from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { useFormat } from "@/explore/useFormat"

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

const describe = (t: TFunction<"conversation">, format: ReturnType<typeof useFormat>) => {
  const { countryName, period, named, locale } = format

  // A source in the middle of a sentence: "the World Bank", "Eurostat", "the OECD".
  const of = (source: Source) =>
    source === "Eurostat" ? source : t(($) => $["the {{source}}"], { source: source })

  // Why a step failed, in plain words.
  const why = (reason: typeof Failed.Type.reason) =>
    Match.valueTags(reason, {
      SourceUnavailable: ({ source }) =>
        t(($) => $["{{value1}} didn't answer"], { value1: of(source) }),
      CatalogUnavailable: () => t(($) => $["indicator search isn't available"]),
      PoliticsUnavailable: () => t(($) => $["political records aren't available"]),
      AgentUnavailable: () => t(($) => $["the assistant didn't answer"]),
      IndicatorNotFound: ({ indicator }) =>
        t(($) => $["there is no indicator {{indicator}}"], { indicator: indicator }),
    })

  const failed = (
    reason: typeof Failed.Type.reason,
    { icon, text }: { icon: LucideIcon; text: string },
  ) => line("Failed", { icon, text: `${text}: ${why(reason)}` })

  // A lookup's lines while it runs, if it fails and if it is stopped:
  // "Looking up research on Germany, 2005 to 2012…".
  const lookingUp = (icon: LucideIcon, asked: string) => ({
    Running: () =>
      line("Running", { icon, text: t(($) => $["Looking up {{asked}}…"], { asked: asked }) }),
    Failed: ({ reason }: { readonly reason: typeof Failed.Type.reason }) =>
      failed(reason, { icon, text: t(($) => $["Couldn't look up {{asked}}"], { asked: asked }) }),
    Stopped: () =>
      line("Stopped", {
        icon,
        text: t(($) => $["Stopped looking up {{asked}}"], { asked: asked }),
      }),
  })

  // A noun as a count takes it: one and many.
  type Noun = readonly [one: string, many: string]

  // "1 country", "3 countries".
  const plural = (count: number, [one, many]: Noun) => `${count} ${count === 1 ? one : many}`

  const thinking = ({ state }: typeof Thinking.Type) =>
    Match.valueTags(state, {
      Running: () => line("Running", { icon: Brain, text: t(($) => $["Thinking…"]) }),
      // The next step, or the answer, takes its place.
      Done: () => undefined,
      Failed: ({ reason }) =>
        failed(reason, { icon: Brain, text: t(($) => $["Couldn't decide what to do"]) }),
      Stopped: () => line("Stopped", { icon: Brain, text: t(($) => $["Stopped thinking"]) }),
    })

  const search = ({ text, source, state }: typeof Search.Type) => {
    const icon = SearchIcon

    const searched = (count: number) => {
      if (source === undefined)
        return count === 0 ? t(($) => $.noMatches, { text }) : t(($) => $.searched, { text, count })

      return count === 0
        ? t(($) => $.noMatchesSource, { text, source })
        : t(($) => $.searchedSource, { text, source, count })
    }

    return Match.valueTags(state, {
      Running: () =>
        line("Running", {
          icon,
          text:
            source === undefined
              ? t(($) => $.searching, { text })
              : t(($) => $.searchingSource, { text, source }),
        }),
      Done: ({ count, top }) =>
        line("Done", {
          icon,
          text: searched(count),
          more: top.map(({ indicator, name }) => `${name} · ${sourceOf(indicator)}`),
        }),
      Failed: ({ reason }) =>
        failed(reason, {
          icon,
          text: t(($) => $["Couldn't search for “{{text}}”"], { text: text }),
        }),
      Stopped: () =>
        line("Stopped", {
          icon,
          text: t(($) => $["Stopped searching for “{{text}}”"], { text: text }),
        }),
    })
  }

  const definition = ({ state }: typeof Definition.Type) => {
    const icon = BookOpen

    return Match.valueTags(state, {
      Running: () => line("Running", { icon, text: t(($) => $["Reading the definition…"]) }),
      Done: ({ name }) =>
        line("Done", { icon, text: t(($) => $["Read “{{name}}”"], { name: name }) }),
      Failed: ({ reason }) =>
        failed(reason, { icon, text: t(($) => $["Couldn't read the definition"]) }),
      Stopped: () => line("Stopped", { icon, text: t(($) => $["Stopped reading the definition"]) }),
    })
  }

  // Each place name and what it matched: "Côte d'Ivoire", or "“Korea” matched
  // 2 places", or "nothing for “Atlantis”".
  const found = (places: ReadonlyArray<{ name: string; countries: ReadonlyArray<Country> }>) =>
    places
      .map(({ name, countries: [first, ...rest] }) =>
        first === undefined
          ? t(($) => $["nothing for “{{name}}”"], { name: name })
          : rest.length === 0
            ? countryName(first)
            : t(($) => $["“{{name}}” matched {{value2}} places"], {
                name: name,
                value2: rest.length + 1,
              }),
      )
      .join(", ")

  const lookup = ({ names, state }: typeof Lookup.Type) => {
    const icon = MapPin
    const asked = names.join(", ")

    return Match.valueTags(state, {
      ...lookingUp(icon, asked),
      // An ambiguous name opens to the places it may mean.
      Done: ({ places }) =>
        line("Done", {
          icon,
          text: t(($) => $["Found {{value1}}"], { value1: found(places) }),
          more: places
            .filter(({ countries }) => countries.length > 1)
            .map(({ name, countries }) => `“${name}”: ${countries.map(countryName).join(", ")}`),
        }),
    })
  }

  // What a lookup's count of each kind of political record calls it.
  const kinds = {
    governments: [t(($) => $["government"]), t(($) => $["governments"])],
    elections: [t(($) => $["election"]), t(($) => $["elections"])],
    events: [t(($) => $["event"]), t(($) => $["events"])],
    reforms: [t(($) => $["reform"]), t(($) => $["reforms"])],
  } as const satisfies Record<string, Noun>

  // "France", "France and Spain", "France, Spain and Italy".
  const joined = (all: ReadonlyArray<string>) =>
    new Intl.ListFormat(locale, { type: "conjunction" }).format(all)

  // "France and Spain", or "4 countries" past three.
  const countriesNamed = (countries: ReadonlyArray<Country>) =>
    countries.length > 3
      ? plural(countries.length, [t(($) => $["country"]), t(($) => $["countries"])])
      : joined(countries.map(countryName))

  // "4 governments and 2 elections", "1 government, 3 events and 1 reform".
  const counted = (counts: typeof Recorded.Type) => {
    const each = (["governments", "elections", "events", "reforms"] as const).flatMap((kind) =>
      counts[kind] === 0 ? [] : [plural(counts[kind], kinds[kind])],
    )

    return each.length === 0 ? t(($) => $["no political records"]) : joined(each)
  }

  const records = ({ countries, from, to, state }: typeof Records.Type) => {
    const icon = Landmark

    const asked = t(($) => $["{{value1}}, {{from}} to {{to}}"], {
      value1: countriesNamed(countries),
      from: from,
      to: to,
    })

    return Match.valueTags(state, {
      ...lookingUp(
        icon,
        t(($) => $["the political record of {{asked}}"], { asked: asked }),
      ),
      Done: (counts) =>
        line("Done", {
          icon,
          text: t(($) => $["Found {{value1}} for {{asked}}"], {
            value1: counted(counts),
            asked: asked,
          }),
        }),
    })
  }

  // Years as a sentence names them: "2009", "2009 to 2025".
  const span = ({ from, to }: { from: number; to: number }) =>
    from === to ? `${from}` : t(($) => $["{{from}} to {{to}}"], { from: from, to: to })

  // A lookup of research findings: "Found 2 research findings on Germany and
  // Spain, 2005 to 2012", opening to their names.
  const research = ({ countries, from, to, state }: typeof Research.Type) => {
    const icon = GraduationCap
    const asked = `${countriesNamed(countries)}, ${span({ from, to })}`

    return Match.valueTags(state, {
      ...lookingUp(
        icon,
        t(($) => $["research on {{asked}}"], { asked: asked }),
      ),
      Done: ({ findings }) =>
        line("Done", {
          icon,
          text: t(($) => $["Found {{value1}} on {{asked}}"], {
            value1:
              findings.length === 0
                ? t(($) => $["no research findings"])
                : plural(findings.length, [
                    t(($) => $["research finding"]),
                    t(($) => $["research findings"]),
                  ]),
            asked: asked,
          }),
          more: findings.map(({ name }) => name),
        }),
    })
  }

  // The countries whose values start before the years they all have, earliest
  // first: "France from 2003, Sweden from 2005".
  const earlier = ({ countries, shared }: typeof Covered.Type) => {
    const start = shared[0]?.from

    const firsts = Map.groupBy(
      countries.filter(({ first }) => start !== undefined && first < start),
      ({ first }) => first,
    )

    return [...firsts]
      .toSorted(([a], [b]) => a - b)
      .map(([first, each]) =>
        t(($) => $["{{value1}} from {{first}}"], {
          value1: joined(each.map(({ country }) => countryName(country))),
          first: first,
        }),
      )
  }

  // What a lookup found: "Found values for 7 countries: all have 2009 to
  // 2025, France from 2003", "Found values for Brazil: 2000 to 2002; none for
  // Argentina".
  const covering = (covered: typeof Covered.Type) => {
    const { countries, shared, missing } = covered
    const [only, ...rest] = countries

    if (only === undefined)
      return t(($) => $["Found no values for {{value1}}"], { value1: countriesNamed(missing) })

    const text =
      rest.length === 0
        ? t(($) => $["Found values for {{value1}}: {{value2}}"], {
            value1: countryName(only.country),
            value2: span({ from: only.first, to: only.last }),
          })
        : [
            t(($) => $["Found values for {{value1}}: {{value2}}"], {
              value1: plural(countries.length, [t(($) => $["country"]), t(($) => $["countries"])]),
              value2:
                shared.length === 0
                  ? t(($) => $["no year they all have"])
                  : t(($) => $["all have {{years}}"], { years: joined(shared.map(span)) }),
            }),
            ...earlier(covered),
          ].join(", ")

    return missing.length === 0
      ? text
      : t(($) => $["{{text}}; none for {{value2}}"], {
          text: text,
          value2: countriesNamed(missing),
        })
  }

  // Why the agent cannot look up the years, in plain words.
  const unresolved = (reason: typeof Unresolved.Type.reason) =>
    Match.valueTags(reason, {
      NoIndicator: ({ indicator }) =>
        t(($) => $["No source has the indicator {{indicator}}."], { indicator: indicator }),
      OpenDimensions: ({ open }) =>
        t(
          ($) => $["The data holds several series, and the lookup has to pick one by {{value1}}."],
          { value1: open.join(", ") },
        ),
    })

  const coverage = ({ indicator, countries, state }: typeof Coverage.Type) => {
    const icon = CalendarRange

    const asked = t(($) => $["which years {{value1}} has for {{value2}}"], {
      value1: of(sourceOf(indicator)),
      value2: countriesNamed(countries),
    })

    return Match.valueTags(state, {
      ...lookingUp(icon, asked),
      // Opens to each country's years.
      Done: (covered) =>
        line("Done", {
          icon,
          text: covering(covered),
          more: [
            ...covered.countries.map(
              ({ country, first, last }) =>
                `${countryName(country)}: ${span({ from: first, to: last })}`,
            ),
            ...covered.missing.map((country) =>
              t(($) => $["{{value1}}: no values"], { value1: countryName(country) }),
            ),
          ],
        }),
      Rejected: ({ reason }) =>
        line("Done", {
          icon,
          text: t(($) => $["Couldn't look up the years, trying again"]),
          more: [unresolved(reason)],
        }),
    })
  }

  // The chart type of a View, as a sentence names it: "a trend", "a map".
  const typeOf = (view: View) =>
    Match.valueTags(view, {
      Trend: () => t(($) => $["a trend"]),
      Ranking: ({ as }) => (as === "Map" ? t(($) => $["a map"]) : t(($) => $["a ranking"])),
      Change: () => t(($) => $["a change"]),
      Relation: () => t(($) => $["a relation"]),
    })

  // Why the agent cannot show the chart it asked for, in plain words.
  const rejected = (view: View, reason: Rejection) =>
    Match.valueTags(reason, {
      NoValues: () =>
        t(($) => $["{{value1}} has no values for {{value2}} in {{value3}}."], {
          value1: named(sourceOf(view.indicator)),
          value2:
            view.countries.length === 1
              ? countryName(view.countries[0])
              : t(($) => $["these countries"]),
          value3: period(view),
        }),
      NoIndicator: ({ indicator }) =>
        t(($) => $["No source has the indicator {{indicator}}."], { indicator: indicator }),
      NotApplicable: () =>
        Match.value(transformOf(view)).pipe(
          Match.when("PerPerson", () =>
            t(($) => $["Per person does not apply to this indicator."]),
          ),
          Match.when("Growth", () =>
            t(($) => $["Annual change does not apply to this indicator."]),
          ),
          Match.when("Index", () => t(($) => $["An index does not apply to this indicator."])),
          Match.orElse(() => t(($) => $["A ratio does not apply to this indicator."])),
        ),
      OpenDimensions: ({ open }) =>
        t(($) => $["The data holds several series, and the chart has to pick one by {{value1}}."], {
          value1: open.join(", "),
        }),
      Short: ({ from, to }) =>
        t(
          ($) => $["{{value1}} has values only from {{from}} to {{to}}, under half of {{value4}}."],
          { value1: named(sourceOf(view.indicator)), from: from, to: to, value4: period(view) },
        ),
      TooMany: ({ most }) =>
        t(($) => $["Too many countries for {{value1}}: {{value2}}, at most {{most}}."], {
          value1: typeOf(view),
          value2: view.countries.length,
          most: most,
        }),
      TooFew: ({ least }) =>
        t(($) => $["Too few countries for {{value1}}: {{value2}}, at least {{least}}."], {
          value1: typeOf(view),
          value2: view.countries.length,
          least: least,
        }),
    })

  const retried = t(($) => $["Tried a chart the data can't show, trying again"])

  // The agent asked for years the data barely covers, and looks for more.
  const thin = t(($) => $["Tried years the data barely covers, trying again"])

  // The agent drew a chart people could not read, and draws another.
  const redrawn = t(($) => $["Tried a chart that would be hard to read, trying again"])

  // What the work log says of a chart the agent tried and could not show.
  const retrying = (reason: Rejection) =>
    Match.valueTags(reason, {
      NoValues: () => retried,
      NoIndicator: () => retried,
      NotApplicable: () => retried,
      OpenDimensions: () => retried,
      Short: () => thin,
      TooMany: () => redrawn,
      TooFew: () => redrawn,
    })

  const fetch = ({ view, state }: typeof Fetch.Type) => {
    const icon = ChartLine
    const source = of(sourceOf(view.indicator))

    const countries = plural(view.countries.length, [
      t(($) => $["country"]),
      t(($) => $["countries"]),
    ])

    return Match.valueTags(state, {
      Running: () =>
        line("Running", {
          icon,
          text: t(($) => $["Fetching {{source}} data for {{countries}}, {{value3}}…"], {
            source: source,
            countries: countries,
            value3: period(view),
          }),
        }),
      Done: ({ values }) =>
        line("Done", {
          icon,
          text: t(($) => $["Got {{value1}} from {{source}}"], {
            value1: plural(values, [t(($) => $["value"]), t(($) => $["values"])]),
            source: source,
          }),
        }),
      Rejected: ({ reason }) =>
        line("Done", { icon, text: retrying(reason), more: [rejected(view, reason)] }),
      Failed: ({ reason }) =>
        failed(reason, {
          icon,
          text: t(($) => $["Couldn't fetch {{source}} data"], { source: source }),
        }),
      Stopped: () =>
        line("Stopped", {
          icon,
          text: t(($) => $["Stopped fetching {{source}} data"], { source: source }),
        }),
    })
  }

  // The line of a step, or none when it has nothing to say, as Thinking once
  // the model decided.
  const lineOf = (step: Step | Saved): Line | undefined =>
    Match.valueTags(step, {
      Thinking: thinking,
      Search: search,
      Definition: definition,
      Lookup: lookup,
      Records: records,
      Research: research,
      Coverage: coverage,
      Fetch: fetch,
      // A block shows in the answer, not in the log.
      Rendered: () => undefined,
      Answered: (answered) => {
        const count = chartsOf(answered).length

        return line("Done", {
          icon: ChartLine,
          text: Match.value(count).pipe(
            Match.when(0, () => t(($) => $["Answered in words"])),
            Match.when(1, () => t(($) => $["Found a chart"])),
            Match.orElse(() => t(($) => $["Found {{count}} charts"], { count: count })),
          ),
        })
      },
      Asked: () =>
        line("Done", { icon: MessageCircleQuestion, text: t(($) => $["Asked which you mean"]) }),
      Unanswered: () => line("Done", { icon: SearchX, text: t(($) => $["Found no indicator"]) }),
      Exhausted: () =>
        line("Stopped", { icon: CircleStop, text: t(($) => $["Reached the limit of steps"]) }),
      Stopped: () => line("Stopped", { icon: CircleStop, text: t(($) => $["Stopped"]) }),
    })

  // The kinds of work the folded line counts.
  const searches: Noun = [t(($) => $["search"]), t(($) => $["searches"])]
  const definitions: Noun = [t(($) => $["definition"]), t(($) => $["definitions"])]
  const lookups: Noun = [t(($) => $["lookup"]), t(($) => $["lookups"])]
  const charts: Noun = [t(($) => $["chart"]), t(($) => $["charts"])]

  // The kind of work a step did. Only a chart the data could show counts as
  // one: a chart tried and rejected, or cut off, is none.
  const kindOf = (step: Saved): Noun | undefined =>
    Match.valueTags(step, {
      Search: () => searches,
      Definition: () => definitions,
      Lookup: () => lookups,
      Records: () => lookups,
      Research: () => lookups,
      Coverage: () => lookups,
      Fetch: ({ state }) => (Predicate.isTagged(state, "Done") ? charts : undefined),
    })

  // The two kinds of work the agent did most, most first, a tie going to the
  // kind it did first: "3 searches, 2 charts".
  const tally = (steps: ReadonlyArray<Saved>) => {
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

  return { lineOf, tally }
}

export const useLines = () => {
  const { t } = useTranslation("conversation")

  const format = useFormat()

  return useMemo(() => describe(t, format), [t, format])
}
