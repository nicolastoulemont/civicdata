import type { ResolvedView } from "@civicdata/domain"
import { ChevronDown } from "lucide-react"
import { Fragment } from "react"

import { buttonVariants } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

import { indicators, page, retrieved } from "./format.ts"

// Level 1: what the indicators measure and where they come from.
export const About = ({ resolved }: { resolved: ResolvedView }) => (
  <Collapsible className="rounded-lg border">
    <CollapsibleTrigger
      className={buttonVariants({ variant: "ghost", className: "w-full justify-between" })}
    >
      About this data
      <ChevronDown aria-hidden />
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-3 px-4 pb-4 text-sm">
      {indicators(resolved).map((indicator, _, all) => (
        <div key={indicator.id} className="space-y-1">
          {all.length > 1 ? <h3 className="font-medium">{indicator.name}</h3> : null}
          <p>{indicator.definition}</p>
        </div>
      ))}
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
    </CollapsibleContent>
  </Collapsible>
)
