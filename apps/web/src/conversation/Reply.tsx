import type { Ending } from "@civicdata/domain"
import { Match } from "effect"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Answer } from "./Answer.tsx"
import { Choices } from "./Choices.tsx"

interface ReplyProps {
  answer: Ending
  disabled: boolean
  choose: (choice: string) => void
}

// How the agent answered: a chart, a question back, or no indicator.
export const Reply = ({ answer, disabled, choose }: ReplyProps) =>
  Match.valueTags(answer, {
    Answered: ({ view, takeaway }) => <Answer view={view} takeaway={takeaway} />,
    Asked: ({ question, choices }) => (
      <Choices question={question} choices={choices} disabled={disabled} choose={choose} />
    ),
    Unanswered: () => (
      <Alert>
        <AlertTitle>No World Bank indicator answers this question</AlertTitle>
        <AlertDescription>
          Name what to measure and where, like “GDP per person in France and Germany since 2000”.
        </AlertDescription>
      </Alert>
    ),
  })
