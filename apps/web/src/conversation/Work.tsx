import { Ending, type Step } from "@civicdata/domain"
import { cn } from "cn"
import { Duration, Schema } from "effect"
import { Brain, ChevronRight, CircleAlert } from "lucide-react"
import { type ReactNode, use, useEffect, useState } from "react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

import { elapsed } from "./elapsed.ts"
import { type Line, lineOf, type Saved, tally } from "./lines.ts"
import { Hold } from "./Scroll.tsx"

const isEnding = Schema.is(Ending)

const trigger =
  "flex w-fit items-center gap-1 rounded-md text-left transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"

const chevron =
  "size-3.5 shrink-0 transition-transform group-data-panel-open/fold:rotate-90 motion-reduce:transition-none"

interface IconProps {
  line: Line
}

// The step's icon, or an error icon when it failed.
const Icon = ({ line }: IconProps) =>
  line.status === "Failed" ? (
    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
  ) : (
    <line.icon aria-hidden className="mt-0.5 size-4 shrink-0" />
  )

interface TextProps {
  line: Line
}

// What the step says. Only a running step shimmers.
const Text = ({ line }: TextProps) => (
  <span className={cn("min-w-0", line.status === "Running" && "shimmer")}>{line.text}</span>
)

interface RowProps {
  line: Line
}

// One step. A step with more to show opens to it, e.g. a search to its best
// matches; one with nothing more is plain text.
const Row = ({ line }: RowProps) => {
  const hold = use(Hold)

  if (line.more.length === 0) {
    return (
      <li className="flex items-start gap-2">
        <Icon line={line} />
        <Text line={line} />
      </li>
    )
  }

  return (
    <li>
      <Collapsible onOpenChange={hold}>
        <CollapsibleTrigger className={cn("group/fold items-start gap-2", trigger)}>
          <Icon line={line} />
          <Text line={line} />
          <ChevronRight aria-hidden className={cn("mt-0.5", chevron)} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-1 ml-6 flex flex-col gap-0.5">
            {line.more.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

interface StepsProps {
  steps: ReadonlyArray<Step | Saved>
  children?: ReactNode
}

// One row per step the agent took, oldest first, each as it last was.
export const Steps = ({ steps, children }: StepsProps) => (
  <ol aria-label="Steps" className="flex flex-col gap-1 text-sm text-muted-foreground">
    {steps.map((step, index) => {
      const line = lineOf(step)

      return line === undefined ? null : (
        // oxlint-disable-next-line react/no-array-index-key -- a step keeps its place as it changes
        <Row key={index} line={line} />
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
// what it has done, and what it is doing now. While no step runs, the model
// is deciding what to do next, so the log never sits still. Screen readers
// hear each step once, when it ends, and not each change on the way.
export const Working = ({ steps, started }: WorkingProps) => {
  const lines = steps.map(lineOf)
  const last = steps.at(-1)

  const deciding =
    (last === undefined || !isEnding(last)) && lines.every((line) => line?.status !== "Running")

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground tabular-nums">
        Working for <Since started={started} />
      </p>
      <Steps steps={steps}>
        {deciding ? (
          <Row line={{ status: "Running", icon: Brain, text: "Thinking…", more: [] }} />
        ) : null}
      </Steps>
      <div role="log" aria-label="Finished steps" className="sr-only">
        {lines.map((line, index) =>
          line === undefined || line.status === "Running" ? null : (
            // oxlint-disable-next-line react/no-array-index-key -- a step keeps its place as it changes
            <p key={index}>{line.text}</p>
          ),
        )}
      </div>
    </div>
  )
}

interface WorkedProps {
  steps: ReadonlyArray<Saved>
  took: Duration.Duration | undefined
}

// The steps of an answered question, folded under one line that says how long
// the agent worked and what it did most. The line opens them.
export const Worked = ({ steps, took }: WorkedProps) => {
  const hold = use(Hold)
  const time = took === undefined ? "Worked" : `Worked for ${elapsed(took)}`

  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground tabular-nums">{time}</p>
  }

  return (
    <Collapsible className="flex flex-col gap-2" onOpenChange={hold}>
      <CollapsibleTrigger
        className={cn("group/fold text-sm text-muted-foreground tabular-nums", trigger)}
      >
        {`${time} · ${tally(steps)}`}
        <ChevronRight aria-hidden className={chevron} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Steps steps={steps} />
      </CollapsibleContent>
    </Collapsible>
  )
}
