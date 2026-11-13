import type { Reading } from "@repo/domain"
import { useId } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"

interface ReadingsProps {
  readings: ReadonlyArray<Reading>
}

// Who wrote a paper, when, and where it appeared: "Gugler, Klaus · 2023 ·
// Energy Economics". A record with no authors starts with its year.
const bylineOf = ({ study }: Reading) =>
  [study.authors.join(", "), String(study.year), study.publisher ?? ""]
    .filter((part) => part !== "")
    .join(" · ")

interface SuggestionProps {
  reading: Reading
}

// One paper to read: its title, linking to its source, who wrote it and
// when, and for a copy we hold the passage the search matched and the
// copy's reuse licences.
const Suggestion = ({ reading }: SuggestionProps) => {
  const { t } = useTranslation("conversation")
  const { study, copy } = reading
  const excerpt = copy?.excerpt ?? null

  return (
    <Item render={<li />} variant="outline" size="sm">
      <ItemContent>
        <ItemTitle className="line-clamp-none">
          <a className="underline underline-offset-4" href={copy?.url ?? study.url}>
            {study.title}
          </a>
        </ItemTitle>
        <ItemDescription>{bylineOf(reading)}</ItemDescription>
        {excerpt === null ? null : (
          <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">
            <p>{excerpt.text}</p>
            <footer>{t(($) => $["Page {{page}}"], { page: excerpt.page })}</footer>
          </blockquote>
        )}
        {copy === null ? null : (
          <p className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {copy.licences.map((licence) => (
              <a key={licence} className="underline underline-offset-4" href={licence}>
                {t(($) => $["Reuse licence"])}
              </a>
            ))}
          </p>
        )}
      </ItemContent>
    </Item>
  )
}

// Papers a search found that no review has read, under the answer. Each
// links to its source: the PDF page the search matched for a copy we hold,
// the study's own page otherwise. They are labelled as not reviewed, since
// the answer's words never draw on them.
export const Readings = ({ readings }: ReadingsProps) => {
  const { t } = useTranslation("conversation")
  const heading = useId()

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 id={heading} className="text-sm font-medium">
          {t(($) => $["Papers to read"])}
        </h3>
        <Badge variant="outline">{t(($) => $["Not reviewed"])}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          ($) =>
            $[
              "Search found these papers, but no review has read them yet. The answer does not draw on them."
            ],
        )}
      </p>
      <ItemGroup className="gap-2">
        {readings.map((reading) => (
          <Suggestion key={reading.id} reading={reading} />
        ))}
      </ItemGroup>
    </section>
  )
}
