import {
  type CatalogEntry,
  type IndicatorId,
  IndicatorNotes,
  type ResolvedView,
  sourceOf,
  type View,
} from "@openfacts/domain"
import { useQuery } from "@tanstack/react-query"
import { Fragment, useId } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

import { notesQuery, searchQuery } from "./api.ts"
import { indicators, page } from "./format.ts"
import { useFormat } from "./useFormat.ts"

// The level of the About tab's own headings, one below the card's title.
type Heading = "h2" | "h4"

// Shown at most, so a stem with dozens of series stays readable.
const relatedShown = 8

// The first three parts of a World Bank code name what it measures; the rest
// name the unit or the group, e.g. NY.GDP.PCAP.CD (current US$) and
// NY.GDP.PCAP.PP.KD (PPP, constant dollars).
const stemOf = (indicator: IndicatorId) => indicator.split(".").slice(0, 3).join(".")

interface SectionProps {
  title: string
  text: string | null
  heading: Heading
}

// One section of a source's notes, under its own heading, left out when the
// source wrote none. Paragraphs are separated by a blank line.
const Section = ({ title, text, heading: Heading }: SectionProps) => {
  const id = useId()

  return text === null ? null : (
    <section aria-labelledby={id} className="space-y-1">
      <Heading id={id} className="font-medium">
        {title}
      </Heading>
      {text.split(/\n\s*\n/).map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </section>
  )
}

// The source's notes, in its own words: the World Bank's on a series,
// Eurostat's reference metadata on a dataset, and the OECD's notes on the
// chart's countries and series. Loaded when About opens; left out when the
// source cannot be reached.
interface NotesProps {
  view: View
  heading: Heading
}

const fromWorldBank = IndicatorNotes.isAnyOf(["World Bank"])
const fromEurostat = IndicatorNotes.isAnyOf(["Eurostat"])

const Notes = ({ view, heading }: NotesProps) => {
  const query = useQuery(notesQuery(view))

  if (query.isPending) return <Skeleton className="h-16 w-full" />

  if (query.data === undefined) return null

  if (fromWorldBank(query.data)) return <WorldBankNotes notes={query.data} heading={heading} />

  if (fromEurostat(query.data)) return <EurostatNotes notes={query.data} heading={heading} />

  return <OecdNotes notes={query.data} heading={heading} />
}

interface WorldBankNotesProps {
  notes: (typeof IndicatorNotes.cases)["World Bank"]["Type"]
  heading: Heading
}

const WorldBankNotes = ({ notes, heading }: WorldBankNotesProps) => {
  const { t } = useTranslation("explore")

  return (
    <>
      <Section title={t(($) => $["Why it matters"])} text={notes.relevance} heading={heading} />
      <Section title={t(($) => $["Limitations"])} text={notes.limitations} heading={heading} />
      <Section title={t(($) => $["Methodology"])} text={notes.methodology} heading={heading} />
      {notes.producer === null ? null : <Producer producer={notes.producer} heading={heading} />}
    </>
  )
}

interface EurostatNotesProps {
  notes: typeof IndicatorNotes.cases.Eurostat.Type
  heading: Heading
}

const EurostatNotes = ({ notes, heading }: EurostatNotesProps) => {
  const { t } = useTranslation("explore")

  return (
    <>
      <Section
        title={t(($) => $["Concepts and definitions"])}
        text={notes.concepts}
        heading={heading}
      />
      <Section title={t(($) => $["Accuracy"])} text={notes.accuracy} heading={heading} />
      <Section
        title={t(($) => $["Comparability across countries"])}
        text={notes.comparability.countries}
        heading={heading}
      />
      <Section
        title={t(($) => $["Comparability over time"])}
        text={notes.comparability.time}
        heading={heading}
      />
      <Section
        title={t(($) => $["Coherence with other statistics"])}
        text={notes.coherence}
        heading={heading}
      />
    </>
  )
}

// Each note, titled by the country it is about.
interface OecdNotesProps {
  notes: typeof IndicatorNotes.cases.OECD.Type
  heading: Heading
}

const OecdNotes = ({ notes, heading }: OecdNotesProps) => {
  const { t } = useTranslation("explore")

  const { countryName } = useFormat()

  return notes.notes.map((note) => {
    const about = note.country === null ? t(($) => $["Every country"]) : countryName(note.country)

    return (
      <Fragment key={`${about} ${JSON.stringify(note.series)}`}>
        <Section
          title={t(($) => $["{{about}}: concepts and definitions"], { about: about })}
          text={note.concepts}
          heading={heading}
        />
        <Section
          title={t(($) => $["{{about}}: quality"], { about: about })}
          text={note.quality}
          heading={heading}
        />
        <Section
          title={t(($) => $["{{about}}: limitations"], { about: about })}
          text={note.limitations}
          heading={heading}
        />
        <Section
          title={t(($) => $["{{about}}: comment"], { about: about })}
          text={note.comment}
          heading={heading}
        />
      </Fragment>
    )
  })
}

// Who produced a World Bank series, linking their page.
interface ProducerProps {
  producer: { readonly name: string; readonly url: string }
  heading: Heading
}

const Producer = ({ producer, heading: Heading }: ProducerProps) => {
  const { t } = useTranslation("explore")

  const id = useId()

  return (
    <section aria-labelledby={id} className="space-y-1">
      <Heading id={id} className="font-medium">
        {t(($) => $["Produced by"])}
      </Heading>
      <a className="underline underline-offset-4" href={producer.url}>
        {producer.name}
      </a>
    </section>
  )
}

// Other World Bank series measuring the same thing in another unit or for
// another group, from the indicator catalog. Left out when there are none or
// the catalog cannot be searched.
interface RelatedProps {
  indicator: IndicatorId
  heading: Heading
  onSwitch: (entry: CatalogEntry) => void
}

const Related = ({ indicator, heading: Heading, onSwitch }: RelatedProps) => {
  const { t } = useTranslation("explore")

  const stem = stemOf(indicator)
  const query = useQuery(searchQuery(stem))

  const related = (query.data ?? [])
    .filter((entry) => entry.indicator !== indicator && stemOf(entry.indicator) === stem)
    .slice(0, relatedShown)

  return related.length === 0 ? null : (
    <section aria-labelledby="related" className="space-y-1">
      <Heading id="related" className="font-medium">
        {t(($) => $["Related indicators"])}
      </Heading>
      <ul>
        {related.map((entry) => (
          <li key={entry.indicator}>
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-left whitespace-normal"
              onClick={() => onSwitch(entry)}
            >
              {entry.name}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface AboutProps {
  resolved: ResolvedView
  heading: Heading
  onSwitch: (entry: CatalogEntry) => void
}

// What the indicators measure, what the source writes about the indicator
// and, for a World Bank indicator, related indicators to switch to, then
// where the data comes from.
export const About = ({ resolved, heading: Heading, onSwitch }: AboutProps) => {
  const { retrieved } = useFormat()

  const { t } = useTranslation("explore")

  return (
    <div className="space-y-3">
      {indicators(resolved).map((indicator, _, all) => (
        <div key={indicator.id} className="space-y-1">
          {all.length > 1 ? <Heading className="font-medium">{indicator.name}</Heading> : null}
          {/* The server sends each definition as plain text, its paragraphs
            separated by a blank line. */}
          {indicator.definition.split("\n\n").map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ))}
      <Notes view={resolved.view} heading={Heading} />
      {sourceOf(resolved.indicator.id) === "World Bank" ? (
        <Related indicator={resolved.indicator.id} heading={Heading} onSwitch={onSwitch} />
      ) : null}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t(($) => $["Official name"])}</dt>
        <dd>{resolved.indicator.name}</dd>
        <dt className="text-muted-foreground">{t(($) => $["Retrieved"])}</dt>
        <dd>{retrieved(resolved)}</dd>
        {resolved.sources.map((source) => (
          <Fragment key={source.indicator}>
            <dt className="text-muted-foreground">{t(($) => $["Source"])}</dt>
            <dd>
              {source.source}, {source.dataset},{" "}
              <a className="underline underline-offset-4" href={page(source)}>
                {source.indicator}
              </a>
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}
