import { Ending, type Step, type Work } from "@civicdata/domain"
import { Duration, Match, Schema } from "effect"
import {
  BookOpen,
  ChartLine,
  ChevronRight,
  CircleStop,
  type LucideIcon,
  MapPin,
  MessageCircleQuestion,
  Search,
  SearchX,
  TriangleAlert,
} from "lucide-react"
import { type ReactNode, use, useEffect, useState } from "react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

import { elapsed } from "./elapsed.ts"
import { Hold } from "./Scroll.tsx"

const isEnding = Schema.is(Ending)

// What a step did, and its icon.
const describe = (step: Step) =>
  Match.valueTags(step, {
    Searched: ({ text }) => ({ icon: Search, text: `Searched indicators for “${text}”` }),
    Described: ({ indicator }) => ({
      icon: BookOpen,
      text: `Read the definition of ${indicator}`,
    }),
    Located: ({ names }) => ({ icon: MapPin, text: `Looked up ${names.join(", ")}` }),
    Rejected: ({ problem }) => ({
      icon: TriangleAlert,
      text: `Tried a chart the data cannot show: ${problem}`,
    }),
    Answered: () => ({ icon: ChartLine, text: "Found a chart" }),
    Asked: () => ({ icon: MessageCircleQuestion, text: "Asked which you mean" }),
    Unanswered: () => ({ icon: SearchX, text: "Found no indicator" }),
    Stopped: () => ({ icon: CircleStop, text: "Stopped" }),
  })

interface LineProps {
  icon: LucideIcon
  children: ReactNode
}

const Line = ({ icon: Icon, children }: LineProps) => (
  <li className="flex items-start gap-2">
    <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
    <span className="min-w-0">{children}</span>
  </li>
)

interface StepsProps {
  steps: ReadonlyArray<Step>
  children?: ReactNode
}

// One line per step the agent took, oldest first.
export const Steps = ({ steps, children }: StepsProps) => (
  <ol aria-label="Steps" className="flex flex-col gap-1 text-sm text-muted-foreground">
    {steps.map((step, index) => {
      const { icon, text } = describe(step)

      return (
        // oxlint-disable-next-line react/no-array-index-key -- steps are only appended
        <Line key={index} icon={icon}>
          {text}
        </Line>
      )
    })}
    {children}
  </ol>
)

interface SinceProps {
  started: number
}

// How long ago `started` was, in epoch milliseconds, moving on every second.
const Since = ({ started }: SinceProps) => {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(timer)
  }, [])

  return elapsed(Duration.millis(now - started))
}

interface WorkingProps {
  steps: ReadonlyArray<Step>
  started: number
}

// The agent at work on the question being answered: how long it has worked,
// what it has done, and, until the answer ends, what it is doing now.
export const Working = ({ steps, started }: WorkingProps) => {
  const last = steps.at(-1)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground tabular-nums">
        Working for <Since started={started} />
      </p>
      <div aria-live="polite">
        <Steps steps={steps}>
          {last !== undefined && isEnding(last) ? null : (
            <Line icon={ChartLine}>
              <span className="shimmer">Finding a chart…</span>
            </Line>
          )}
        </Steps>
      </div>
    </div>
  )
}

interface WorkedProps {
  steps: ReadonlyArray<Work>
  took: Duration.Duration | undefined
}

// The steps of an answered question, folded under one line that says how long
// the agent worked. The line opens them.
export const Worked = ({ steps, took }: WorkedProps) => {
  const hold = use(Hold)
  const label = took === undefined ? "Worked" : `Worked for ${elapsed(took)}`

  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground tabular-nums">{label}</p>
  }

  return (
    <Collapsible className="flex flex-col gap-2" onOpenChange={hold}>
      <CollapsibleTrigger className="group/fold flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground tabular-nums transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none">
        {label}
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform group-data-panel-open/fold:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Steps steps={steps} />
      </CollapsibleContent>
    </Collapsible>
  )
}
