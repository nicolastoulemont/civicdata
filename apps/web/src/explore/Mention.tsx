import { type Cited, type Country, nameOf } from "@civicdata/domain"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"

import { card } from "./politics.ts"

interface MentionProps {
  record: Cited
  // The countries of the charts the words describe.
  countries: ReadonlyArray<Country>
}

// A record the agent's words cite, by its name: a link to the page that
// establishes it, whose card shows what the chart's tooltip says of it.
export const Mention = ({ record, countries }: MentionProps) => {
  const { lines, pages, link } = card(record, countries)

  return (
    <HoverCard>
      <HoverCardTrigger
        href={link}
        className="underline decoration-muted-foreground decoration-dotted underline-offset-4 hover:decoration-foreground"
      >
        {nameOf(record)}
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
