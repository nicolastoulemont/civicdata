import type { ResolvedView } from "@civicdata/domain"
import { DateTime } from "effect"
import { ChevronDown } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

export const retrieved = (resolved: ResolvedView) =>
  DateTime.toDateUtc(resolved.provenance.retrievedAt).toLocaleDateString("en-GB", {
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
        <dt className="text-muted-foreground">Source</dt>
        <dd>{resolved.provenance.source}</dd>
        <dt className="text-muted-foreground">Dataset</dt>
        <dd>{resolved.provenance.dataset}</dd>
        <dt className="text-muted-foreground">Indicator</dt>
        <dd>
          <a
            className="underline underline-offset-4"
            href={`https://data.worldbank.org/indicator/${resolved.indicator.id}`}
          >
            {resolved.indicator.id}
          </a>
        </dd>
        <dt className="text-muted-foreground">Retrieved</dt>
        <dd>{retrieved(resolved)}</dd>
      </dl>
    </CollapsibleContent>
  </Collapsible>
)
