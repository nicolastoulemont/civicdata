import { type Cite, type Country, nameOf } from "@civicdata/domain"
import { Fragment } from "react"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"

import { card } from "./politics.ts"

interface MentionProps {
  cite: typeof Cite.Type
  // The countries of the charts the words describe.
  countries: ReadonlyArray<Country>
}

// A record the agent's words cite, by its name: a link to the page that
// establishes it, whose card shows what the chart's tooltip says of it.
const Mention = ({ cite, countries }: MentionProps) => {
  const { lines, pages, link } = card(cite.record, countries)

  return (
    <HoverCard>
      <HoverCardTrigger
        href={link}
        className="underline decoration-muted-foreground decoration-dotted underline-offset-4 hover:decoration-foreground"
      >
        {nameOf(cite.record)}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        <ul className="grid gap-1">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <ol className="grid list-decimal gap-1 pl-4 text-muted-foreground">
          {pages.map((page) => (
            <li key={page.url}>
              <a className="underline underline-offset-4" href={page.url}>
                {page.title}
              </a>
            </li>
          ))}
        </ol>
      </HoverCardContent>
    </HoverCard>
  )
}

interface CitedProps {
  text: string
  // The records the text cites, in order, each where its name starts.
  cites: ReadonlyArray<typeof Cite.Type>
  // The countries of the charts the text describes, which name who an event
  // concerns.
  countries: ReadonlyArray<Country>
}

// The agent's words, with each record they cite as a mention in its place.
export const Cited = ({ text, cites, countries }: CitedProps) => {
  const ends = cites.map(({ at, record }) => at + nameOf(record).length)

  return (
    <>
      {text.slice(0, cites[0]?.at)}
      {cites.map((cite, index) => (
        <Fragment key={cite.at}>
          <Mention cite={cite} countries={countries} />
          {text.slice(ends[index], cites[index + 1]?.at)}
        </Fragment>
      ))}
    </>
  )
}
