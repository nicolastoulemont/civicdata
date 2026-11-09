import type { Step } from "@civicdata/domain"
import { Match } from "effect"

import { Spinner } from "@/components/ui/spinner"

const describe = (step: Step) =>
  Match.valueTags(step, {
    Searched: ({ text }) => `Searched indicators for “${text}”`,
    Described: ({ indicator }) => `Read the definition of ${indicator}`,
    Located: ({ names }) => `Looked up ${names.join(", ")}`,
    Rejected: ({ problem }) => `Tried a chart the data cannot show: ${problem}`,
    Answered: () => "Found a chart",
    Asked: () => "Asked which you mean",
    Unanswered: () => "Found no indicator",
  })

interface WorkProps {
  steps: ReadonlyArray<Step>
  answering: boolean
}

// What the agent has done so far for the question it is answering.
export const Work = ({ steps, answering }: WorkProps) => (
  <ol aria-live="polite" className="flex flex-col gap-1 text-sm text-muted-foreground">
    {steps.map((step, index) => (
      // oxlint-disable-next-line react/no-array-index-key -- steps are only appended
      <li key={index}>{describe(step)}</li>
    ))}
    {answering ? (
      <li className="flex items-center gap-2">
        <Spinner aria-hidden />
        Finding a chart…
      </li>
    ) : null}
  </ol>
)
