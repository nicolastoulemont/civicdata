import { type Chart, type Cite, type Country, nameOf } from "@civicdata/domain"
import { Fragment } from "react"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"

import { card } from "./politics.ts"

interface MentionProps {
  cite: typeof Cite.Type
  // The countries of the chart the takeaway describes.
  countries: ReadonlyArray<Country>
}

// A record a takeaway cites, by its name: a link to the page that
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
  // A chart with the takeaway the agent kept for it.
  explained: Chart & { readonly takeaway: string }
}

// A takeaway's text, with each record it cites as a mention in its place.
export const Cited = ({ explained: { view, takeaway, cites: cited } }: CitedProps) => {
  const cites: ReadonlyArray<typeof Cite.Type> = cited ?? []
  const ends = cites.map(({ at, record }) => at + nameOf(record).length)

  return (
    <>
      {takeaway.slice(0, cites[0]?.at)}
      {cites.map((cite, index) => (
        <Fragment key={cite.at}>
          <Mention cite={cite} countries={view.countries} />
          {takeaway.slice(ends[index], cites[index + 1]?.at)}
        </Fragment>
      ))}
    </>
  )
}
