import type { Ending } from "@civicdata/domain"
import { Match } from "effect"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Answer } from "./Answer.tsx"

interface ReplyProps {
  answer: Ending
}

// How the agent answered: a chart, a question back, no indicator, or nothing
// because the person stopped it.
export const Reply = ({ answer }: ReplyProps) =>
  Match.valueTags(answer, {
    Answered: (answered) => <Answer agent={answered} />,
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
