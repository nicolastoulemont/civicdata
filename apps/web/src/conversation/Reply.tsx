import {
  type Chart,
  ChartIndex,
  type ConversationId,
  type Turn,
  type TurnIndex,
} from "@civicdata/domain"
import { Match } from "effect"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Answer } from "./Answer.tsx"
import { Charts } from "./Charts.tsx"

interface ReplyProps {
  id: ConversationId
  index: TurnIndex
  turn: Turn
}

// How the agent answered: its charts in the order it drew them, a question
// back, no indicator, or the charts drawn before the person stopped it.
export const Reply = ({ id, index, turn }: ReplyProps) => {
  const answers = (charts: ReadonlyArray<Chart>) => (
    <Charts
      charts={charts.map((chart, place) => (
        <Answer
          // oxlint-disable-next-line react/no-array-index-key -- a chart keeps its place in its answer
          key={place}
          id={id}
          turn={index}
          chart={ChartIndex.make(place)}
          agent={chart}
          shown={turn.shown?.[place] ?? undefined}
        />
      ))}
    />
  )

  return Match.valueTags(turn.answer, {
    Answered: ({ charts }) => answers(charts),
    Asked: ({ question }) => <p>{question}</p>,
    Unanswered: () => (
      <Alert>
        <AlertTitle>No World Bank indicator answers this question</AlertTitle>
        <AlertDescription>
          Name what to measure and where, like “GDP per person in France and Germany since 2000”.
        </AlertDescription>
      </Alert>
    ),
    Stopped: ({ charts = [] }) => (
      <>
        {charts.length === 0 ? null : answers(charts)}
        <p className="text-sm text-muted-foreground">You stopped</p>
      </>
    ),
  })
}
