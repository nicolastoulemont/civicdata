import {
  AgentUnavailable,
  type Answered,
  type View,
  SourceUnavailable,
  TooManyQuestions,
} from "@civicdata/domain"
import { useMutation } from "@tanstack/react-query"
import { Data, Match } from "effect"
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

type Explained = typeof Answered.Type

// What the agent has said about the chart on screen: nothing yet, its
// takeaway, a takeaway withheld because it cited numbers not in the data, or
// a takeaway for the chart before the person's changes.
type Said = Data.TaggedEnum<{
  Nothing: {}
  Current: { readonly takeaway: string }
  Withheld: {}
  Earlier: { readonly takeaway: string }
}>

const Said = Data.taggedEnum<Said>()

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

interface TextProps {
  said: Said
}

const Text = ({ said }: TextProps) =>
  Match.valueTags(said, {
    Nothing: () => null,
    Current: ({ takeaway }) => <p>{takeaway}</p>,
    Withheld: () => (
      <p className="text-sm text-muted-foreground">
        The assistant cited numbers that are not in the data, so its explanation is not shown.
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
  agent: Explained | undefined
}

// The agent's takeaway for the chart on screen: the one it answered with, or
// one asked for on demand. Changes never ask the agent, so after one the
// takeaway describes an earlier chart: it greys out and the button asks
// again. Changing back to a chart already explained shows its takeaway.
export const Takeaway = ({ view, agent }: TakeawayProps) => {
  const hold = use(Hold)
  const explaining = useMutation({ mutationFn: explain })

  const said = saidOf(view, [
    ...(explaining.data === undefined ? [] : [explaining.data]),
    ...(agent?.takeaway === undefined ? [] : [agent]),
  ])

  return (
    <section aria-label="Takeaway" className="flex flex-col items-start gap-2">
      <Text said={said} />
      {Said.$is("Current")(said) ? null : (
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
      {explaining.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{problemOf(explaining.error)}</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
