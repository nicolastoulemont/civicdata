import type { Cite, Country } from "@civicdata/domain"
import { cn } from "cn"

import { Cited } from "./Cited.tsx"

interface ParagraphsProps {
  text: string
  // The records the text cites, each where its name starts in the text.
  cites?: ReadonlyArray<typeof Cite.Type> | undefined
  // The countries of the charts the text describes.
  countries?: ReadonlyArray<Country>
  className?: string | undefined
}

const none: ReadonlyArray<never> = []

// A blank line between two runs of lines.
const breaks = /\n\s*\n/g

// Where each paragraph starts and ends in the text.
const spansOf = (text: string) => {
  const ends = Array.from(text.matchAll(breaks), (found) => ({
    end: found.index,
    next: found.index + found[0].length,
  }))

  return [0, ...ends.map(({ next }) => next)].map((start, index) => ({
    start,
    end: ends[index]?.end ?? text.length,
  }))
}

// Plain text the agent wrote, one paragraph per run of lines between blank
// lines, with each record it cites in its place.
export const Paragraphs = ({
  text,
  cites = none,
  countries = none,
  className,
}: ParagraphsProps) => (
  <div className={cn("flex flex-col gap-3", className)}>
    {spansOf(text).map(({ start, end }) => (
      <p key={start}>
        <Cited
          text={text.slice(start, end)}
          cites={cites
            .filter(({ at }) => at >= start && at < end)
            .map(({ at, record }) => ({ at: at - start, record }))}
          countries={countries}
        />
      </p>
    ))}
  </div>
)
