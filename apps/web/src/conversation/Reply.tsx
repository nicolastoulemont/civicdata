import { ChartIndex, type ConversationId, type Turn, type TurnIndex } from "@civicdata/domain"
import { Match } from "effect"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Answer } from "./Answer.tsx"

interface ReplyProps {
  id: ConversationId
  index: TurnIndex
  turn: Turn
}

// How the agent answered: its charts in the order it drew them, a question
// back, no indicator, or nothing because the person stopped it.
export const Reply = ({ id, index, turn }: ReplyProps) =>
  Match.valueTags(turn.answer, {
    Answered: ({ charts }) => (
      <div className="flex flex-col gap-4">
        {charts.map((chart, place) => (
          // oxlint-disable-next-line react/no-array-index-key -- a chart keeps its place in its answer
          <section key={place} aria-label={`Chart ${place + 1} of the answer`}>
            <Answer
              id={id}
              turn={index}
              chart={ChartIndex.make(place)}
              agent={chart}
              shown={turn.shown?.[place] ?? undefined}
            />
          </section>
        ))}
      </div>
    ),
    Asked: ({ question }) => <p>{question}</p>,
    Unanswered: () => (
      <Alert>
        <AlertTitle>No World Bank indicator answers this question</AlertTitle>
        <AlertDescription>
          Name what to measure and where, like “GDP per person in France and Germany since 2000”.
        </AlertDescription>
      </Alert>
    ),
    Stopped: () => <p className="text-sm text-muted-foreground">You stopped</p>,
  })
