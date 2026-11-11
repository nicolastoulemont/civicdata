import {
  type Block,
  ChartIndex,
  chartsOf,
  type ConversationId,
  type Turn,
  type TurnIndex,
} from "@civicdata/domain"
import { Match } from "effect"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Answer } from "./Answer.tsx"
import { Blocks } from "./Blocks.tsx"

interface ReplyProps {
  id: ConversationId
  index: TurnIndex
  turn: Turn
}

// How the agent answered: what it wrote and the charts it drew, in order, a
// question back after any blocks written before it, nothing, or the blocks
// written before the agent reached its limit or the person stopped it.
export const Reply = ({ id, index, turn }: ReplyProps) => {
  const charts = chartsOf(turn.answer).map((chart, place) => (
    <Answer
      // oxlint-disable-next-line react/no-array-index-key -- a chart keeps its place in its answer
      key={place}
      id={id}
      turn={index}
      chart={ChartIndex.make(place)}
      agent={chart}
      shown={turn.shown?.[place] ?? undefined}
    />
  ))

  const changed = turn.shown?.some((view) => view !== null) ?? false

  const answers = (blocks: ReadonlyArray<Block>) => (
    <Blocks blocks={blocks} charts={charts} changed={changed} />
  )

  return Match.valueTags(turn.answer, {
    Answered: ({ blocks }) => answers(blocks),
    Asked: ({ question, blocks = [] }) => (
      <>
        {blocks.length === 0 ? null : answers(blocks)}
        <p>{question}</p>
      </>
    ),
    Unanswered: () => (
      <Alert>
        <AlertTitle>No World Bank indicator answers this question</AlertTitle>
        <AlertDescription>
          Name what to measure and where, like “GDP per person in France and Germany since 2000”.
        </AlertDescription>
      </Alert>
    ),
    Exhausted: ({ blocks = [] }) => (
      <>
        {blocks.length === 0 ? null : answers(blocks)}
        <p className="text-sm text-muted-foreground">
          Cut short: civicdata reached its limit of steps before it finished this answer
        </p>
      </>
    ),
    Stopped: ({ blocks = [] }) => (
      <>
        {blocks.length === 0 ? null : answers(blocks)}
        <p className="text-sm text-muted-foreground">You stopped</p>
      </>
    ),
  })
}
