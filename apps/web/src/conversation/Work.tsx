import { Chart, Ending, Rendered, type Step, type View } from "@repo/domain"
import { useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { Duration, Match, Schema } from "effect"
import { Brain, CircleAlert, CircleCheck } from "lucide-react"
import { type ReactNode, use, useEffect, useState } from "react"
import { Trans, useTranslation } from "react-i18next"

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { resolveQuery } from "@/explore/api"
import { indicatorNames, subject } from "@/explore/format"
import { Hold } from "@/hold"

import { elapsed } from "./elapsed.ts"
import { type Line, useLines, type Saved } from "./lines.ts"

const isEnding = Schema.is(Ending)

const isRendered = Schema.is(Rendered)
const isChart = Schema.is(Chart)

// How a step's line reads in the trace: a running step shimmers and a failed
// one is red; a done or stopped one is plain.
const statusOf = (line: Line) =>
  Match.value(line.status).pipe(
    Match.when("Running", () => "running" as const),
    Match.when("Failed", () => "error" as const),
    Match.orElse(() => undefined),
  )

interface MarkProps {
  line: Line
  ran: boolean
}

// The step's own icon while it runs, then a check once it is done, or an
// alert if it failed. A step seen running turns to its end with a short zoom;
// one already over when it appeared shows its end still.
const Mark = ({ line, ran }: MarkProps) => {
  const end = cn(ran && "animate-in duration-300 fade-in zoom-in-50 motion-reduce:animate-none")

  return (
    <TraceIcon className="mt-0.5">
      {Match.value(line.status).pipe(
        Match.when("Done", () => <CircleCheck className={end} />),
        Match.when("Failed", () => <CircleAlert className={end} />),
        Match.orElse(() => <line.icon />),
      )}
    </TraceIcon>
  )
}

interface RowProps {
  line: Line
}

// One step. A step with more to show opens to it, e.g. a search to its best
// matches; one with nothing more is plain text. Long text wraps rather than
// cut a failure's reason short.
const Row = ({ line }: RowProps) => {
  const hold = use(Hold)
  // Kept here, since the row's inside changes once a done step has more.
  const [ran] = useState(line.status === "Running")

  const body = (
    <TraceLine status={statusOf(line)} className="items-start">
      <Mark line={line} ran={ran} />
      <TraceTitle className="whitespace-normal">{line.text}</TraceTitle>
    </TraceLine>
  )

  if (line.more.length === 0) return <li>{body}</li>

  return (
    <li>
      <TraceCollapsible onOpenChange={hold}>
        <TraceCollapsibleTrigger className="items-start [&>[data-slot=trace-icon]]:mt-0.5">
          {body}
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ul className="flex flex-col gap-0.5 text-sm">
            {line.more.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </li>
  )
}

interface StepsProps {
  steps: ReadonlyArray<Step | Saved>
  children?: ReactNode
}

// One row per step the agent took, oldest first, each as it last was.
export const Steps = ({ steps, children }: StepsProps) => {
  const { t } = useTranslation("conversation")
  const { lineOf } = useLines()

  return (
    <Trace render={<ol />} aria-label={t(($) => $["Steps"])}>
      {steps.map((step, index) => {
        const line = lineOf(step)

        return line === undefined ? null : (
          // oxlint-disable-next-line react/no-array-index-key -- a step keeps its place as it changes
          <Row key={index} line={line} />
        )
      })}
      {children}
    </Trace>
  )
}

interface SinceProps {
  started: number
}

// How long ago `started` was, in epoch milliseconds, moving on every second.
const Since = ({ started }: SinceProps) => {
  const { t } = useTranslation("conversation")
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(timer)
  }, [])

  return elapsed(Duration.millis(now - started), t)
}

interface HeardProps {
  view: View
  place: number
}

// "Chart 1 of the answer: Life expectancy at birth", once the chart's data
// has loaded and named its indicator, so screen readers hear it once.
const Heard = ({ view, place }: HeardProps) => {
  const { t } = useTranslation("conversation")
  const query = useQuery(resolveQuery(view))

  if (query.isPending) return null

  const known = indicatorNames(query.data === undefined ? [] : [query.data])

  return (
    <p>
      {t(($) => $["Chart {{place}} of the answer: {{subject}}"], {
        place: place + 1,
        subject: subject(view, known),
      })}
    </p>
  )
}

interface WorkingProps {
  steps: ReadonlyArray<Step>
  started: number
}

// How long the agent has worked on the question being answered. Screen
// readers hear each step once, when it ends, and not each change on the way,
// and each chart once, when it is drawn.
export const Working = ({ steps, started }: WorkingProps) => {
  const { lineOf } = useLines()
  const { t } = useTranslation("conversation")

  return (
    <>
      <p className="text-sm text-muted-foreground tabular-nums">
        <Trans
          t={t}
          i18nKey={($) => $["Working for <time/>"]}
          components={{ time: <Since started={started} /> }}
        />
      </p>
      <div role="log" aria-label={t(($) => $["Finished steps"])} className="sr-only">
        {steps.map((step, index) => {
          const line = lineOf(step)

          return line === undefined || line.status === "Running" ? null : (
            // oxlint-disable-next-line react/no-array-index-key -- a step keeps its place as it changes
            <p key={index}>{line.text}</p>
          )
        })}
        {steps
          .flatMap((step) => (isRendered(step) && isChart(step.block) ? [step.block] : []))
          .map(({ view }, place) => (
            // oxlint-disable-next-line react/no-array-index-key -- a chart keeps its place in its answer
            <Heard key={place} view={view} place={place} />
          ))}
      </div>
    </>
  )
}

// What the agent did while it answers, cut at each block it sent: the steps
// before each block, then those since the last, where it is at work now.
// While no step runs, the model is deciding what to do next, so the last
// steps never sit still.
export const useRuns = () => {
  const { lineOf } = useLines()
  const { t } = useTranslation("conversation")

  return (steps: ReadonlyArray<Step>): ReadonlyArray<ReactNode> => {
    const cut: Array<Array<Step>> = [[]]

    for (const step of steps) {
      if (isRendered(step)) cut.push([])
      else cut[cut.length - 1]?.push(step)
    }

    const last = steps.at(-1)

    const deciding =
      (last === undefined || !isEnding(last)) &&
      steps.every((step) => lineOf(step)?.status !== "Running")

    return cut.map((run, index) => {
      const now = index === cut.length - 1 && deciding

      return run.length === 0 && !now ? null : (
        // oxlint-disable-next-line react/no-array-index-key -- a run keeps its place in its answer
        <Steps key={index} steps={run}>
          {now ? (
            <Row
              line={{ status: "Running", icon: Brain, text: t(($) => $["Thinking…"]), more: [] }}
            />
          ) : null}
        </Steps>
      )
    })
  }
}

interface WorkedProps {
  steps: ReadonlyArray<Saved>
  took: Duration.Duration | undefined
}

// The steps of an answered question, folded under one line that says how long
// the agent worked and what it did most. The line opens them.
export const Worked = ({ steps, took }: WorkedProps) => {
  const { t } = useTranslation("conversation")
  const { tally } = useLines()
  const hold = use(Hold)

  const time =
    took === undefined
      ? t(($) => $["Worked"])
      : t(($) => $["Worked for {{time}}"], { time: elapsed(took, t) })

  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground tabular-nums">{time}</p>
  }

  return (
    <TraceCollapsible onOpenChange={hold}>
      <TraceCollapsibleTrigger className="text-sm tabular-nums">
        {[time, tally(steps)].filter((part) => part !== "").join(" · ")}
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Steps steps={steps} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
