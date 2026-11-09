import { type CatalogEntry, type IndicatorId, type ResolvedView, sourceOf } from "@civicdata/domain"
import { useQuery } from "@tanstack/react-query"
import { Fragment } from "react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

import { notesQuery, searchQuery } from "./api.ts"
import { indicators, page, retrieved } from "./format.ts"

// The level of the About tab's own headings, one below the card's title.
type Heading = "h2" | "h4"

// Shown at most, so a stem with dozens of series stays readable.
const relatedShown = 8

// The first three parts of a World Bank code name what it measures; the rest
// name the unit or the group, e.g. NY.GDP.PCAP.CD (current US$) and
// NY.GDP.PCAP.PP.KD (PPP, constant dollars).
const stemOf = (indicator: IndicatorId) => indicator.split(".").slice(0, 3).join(".")

// Why the indicator matters and its limitations, in the World Bank's words.
// Loaded when About opens; left out when the World Bank cannot be reached.
interface NotesProps {
  indicator: IndicatorId
  heading: Heading
}

const Notes = ({ indicator, heading: Heading }: NotesProps) => {
  const query = useQuery(notesQuery(indicator))

  if (query.isPending) return <Skeleton className="h-16 w-full" />

  return query.data === undefined ? null : (
    <>
      {query.data.relevance === null ? null : (
        <section aria-labelledby="relevance" className="space-y-1">
          <Heading id="relevance" className="font-medium">
            Why it matters
          </Heading>
          <p>{query.data.relevance}</p>
        </section>
      )}
      {query.data.limitations === null ? null : (
        <section aria-labelledby="limitations" className="space-y-1">
          <Heading id="limitations" className="font-medium">
            Limitations
          </Heading>
          <p>{query.data.limitations}</p>
        </section>
      )}
    </>
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
  const stem = stemOf(indicator)
  const query = useQuery(searchQuery(stem))

  const related = (query.data ?? [])
    .filter((entry) => entry.indicator !== indicator && stemOf(entry.indicator) === stem)
    .slice(0, relatedShown)

  return related.length === 0 ? null : (
    <section aria-labelledby="related" className="space-y-1">
      <Heading id="related" className="font-medium">
        Related indicators
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

// What the indicators measure and, for a World Bank indicator, why it
// matters, its limitations and related indicators to switch to, then where
// the data comes from.
export const About = ({ resolved, heading: Heading, onSwitch }: AboutProps) => (
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
    {sourceOf(resolved.indicator.id) === "World Bank" ? (
      <>
        <Notes indicator={resolved.indicator.id} heading={Heading} />
        <Related indicator={resolved.indicator.id} heading={Heading} onSwitch={onSwitch} />
      </>
    ) : null}
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      <dt className="text-muted-foreground">Official name</dt>
      <dd>{resolved.indicator.name}</dd>
      <dt className="text-muted-foreground">Retrieved</dt>
      <dd>{retrieved(resolved)}</dd>
      {resolved.sources.map((source) => (
        <Fragment key={source.indicator}>
          <dt className="text-muted-foreground">Source</dt>
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
