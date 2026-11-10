import {
  AgentUnavailable,
  type Chart,
  Drawn,
  type View,
  SourceUnavailable,
  TooManyQuestions,
} from "@civicdata/domain"
import { useMutation } from "@tanstack/react-query"
import { Data, Match, Schema, Struct } from "effect"
import { use } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Hold } from "@/hold"

import { explain } from "./api.ts"
import { named } from "./format.ts"
import { toQuery } from "./search.ts"

const problemOf = (error: Error) =>
  error instanceof AgentUnavailable
    ? "The assistant is not available"
    : error instanceof TooManyQuestions
      ? "Too many questions in a minute"
      : error instanceof SourceUnavailable
        ? `${named(error.source)} is not responding`
        : "The chart could not be explained"

type Explained = Chart

// The chart the agent drew in a conversation: one of its answer's charts,
// or one still being drawn, whose takeaway may not be written yet.
export type Agent = Chart | typeof Drawn.Type

const isDrawn = Schema.is(Drawn)

// What the agent has said about the chart on screen: nothing yet, a takeaway
// it is writing, its takeaway, a takeaway withheld because it failed the
// check against the data and the political records, or a takeaway for the chart before the person's changes.
type Said = Data.TaggedEnum<{
  Nothing: {}
  Writing: {}
  Current: { readonly takeaway: string }
  Withheld: {}
  Earlier: { readonly takeaway: string }
}>

const Said = Data.taggedEnum<Said>()

// The agent's chart with the takeaway it kept, if any, once it has written
// one or stopped.
const keptOf = (agent: Agent): Explained | undefined =>
  isDrawn(agent)
    ? Match.valueTags(agent.state, {
        Running: () => undefined,
        Done: (done) => ({ view: agent.view, ...Struct.omit(done, ["_tag"]) }),
        Stopped: () => ({ view: agent.view }),
      })
    : agent

// Prefers a takeaway for the chart on screen, then the latest one.
const saidOf = (view: View, known: ReadonlyArray<Explained>): Said => {
  const current = known.find((explained) => toQuery(explained.view) === toQuery(view))

  if (current !== undefined)
    return current.takeaway === undefined
      ? Said.Withheld()
      : Said.Current({ takeaway: current.takeaway })

  const earlier = known.find((explained) => explained.takeaway !== undefined)?.takeaway

  return earlier === undefined ? Said.Nothing() : Said.Earlier({ takeaway: earlier })
}

// What the agent has said about the chart on screen, given its own chart and
// the takeaway asked for on demand, if any. While it writes the takeaway of
// the chart on screen, it has said nothing else.
const saidFor = (
  view: View,
  { agent, explained }: { agent: Agent | undefined; explained: Explained | undefined },
): Said => {
  const kept = agent === undefined ? undefined : keptOf(agent)

  if (
    agent !== undefined &&
    kept === undefined &&
    explained === undefined &&
    toQuery(agent.view) === toQuery(view)
  ) {
    return Said.Writing()
  }

  return saidOf(view, [
    ...(explained === undefined ? [] : [explained]),
    ...(kept?.takeaway === undefined ? [] : [kept]),
  ])
}

interface TextProps {
  said: Said
}

const Text = ({ said }: TextProps) =>
  Match.valueTags(said, {
    Nothing: () => null,
    Writing: () => <p className="shimmer text-sm text-muted-foreground">Writing the takeaway…</p>,
    Current: ({ takeaway }) => <p>{takeaway}</p>,
    Withheld: () => (
      <p className="text-sm text-muted-foreground">
        The assistant's explanation did not match the data and records behind the chart, so it is
        not shown.
      </p>
    ),
    Earlier: ({ takeaway }) => (
      <>
        <p className="text-muted-foreground">{takeaway}</p>
        <p className="text-sm text-muted-foreground">
          This describes the chart before your changes.
        </p>
      </>
    ),
  })

interface TakeawayProps {
  view: View
  // The chart the agent answered a question with, and its takeaway.
  agent: Agent | undefined
  onChange: (view: View) => void
}

// The agent's takeaway for the chart on screen: the one it answered with,
// the one it is writing, or one asked for on demand. Changes never ask the
// agent, so after one the takeaway describes an earlier chart: it greys out
// and the button asks again. Changing back to a chart already explained
// shows its takeaway, and a changed chart in a conversation can go back to
// the agent's.
export const Takeaway = ({ view, agent, onChange }: TakeawayProps) => {
  const hold = use(Hold)
  const explaining = useMutation({ mutationFn: explain })

  const said = saidFor(view, { agent, explained: explaining.data })

  return (
    <section aria-label="Takeaway" className="flex flex-col items-start gap-2">
      <Text said={said} />
      <div className="flex flex-wrap gap-2 empty:hidden">
        {Said.$is("Current")(said) || Said.$is("Writing")(said) ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={explaining.isPending}
            onClick={() => {
              hold()
              explaining.mutate(view)
            }}
          >
            {explaining.isPending ? <Spinner aria-hidden /> : null}
            Explain this chart
          </Button>
        )}
        {agent === undefined || toQuery(agent.view) === toQuery(view) ? null : (
          <Button variant="outline" size="sm" onClick={() => onChange(agent.view)}>
            Back to the agent's chart
          </Button>
        )}
      </div>
      {explaining.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{problemOf(explaining.error)}</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
