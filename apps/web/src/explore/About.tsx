import type { ResolvedView } from "@civicdata/domain"
import { DateTime } from "effect"
import { ChevronDown } from "lucide-react"
import { Fragment } from "react"

import { buttonVariants } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

// When the first series was retrieved; the others were fetched with it.
export const retrieved = (resolved: ResolvedView) =>
  DateTime.toDateUtc(resolved.sources[0].retrievedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

// Level 1: what the indicator measures and where it comes from.
export const About = ({ resolved }: { resolved: ResolvedView }) => (
  <Collapsible className="rounded-lg border">
    <CollapsibleTrigger
      className={buttonVariants({ variant: "ghost", className: "w-full justify-between" })}
    >
      About this data
      <ChevronDown aria-hidden />
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-3 px-4 pb-4 text-sm">
      <p>{resolved.indicator.definition}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Retrieved</dt>
        <dd>{retrieved(resolved)}</dd>
        {resolved.sources.map((source) => (
          <Fragment key={source.indicator}>
            <dt className="text-muted-foreground">Source</dt>
            <dd>
              {source.source}, {source.dataset},{" "}
              <a
                className="underline underline-offset-4"
                href={`https://data.worldbank.org/indicator/${source.indicator}`}
              >
                {source.indicator}
              </a>
            </dd>
          </Fragment>
        ))}
      </dl>
    </CollapsibleContent>
  </Collapsible>
)
