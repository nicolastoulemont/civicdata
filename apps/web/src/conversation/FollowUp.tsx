import type { ConversationId, Ending } from "@civicdata/domain"
import { Match } from "effect"

import { Choices } from "./Choices.tsx"
import { Lane } from "./Lane.tsx"
import { type Answering, QuestionForm } from "./QuestionForm.tsx"

// What to suggest next, from how the agent last answered.
const suggest = (last: Ending | undefined, answering: Answering | undefined) =>
  answering !== undefined
    ? "Write your next question while civicdata answers"
    : last === undefined
      ? "How has life expectancy changed in Brazil?"
      : Match.valueTags(last, {
          Answered: () => "Add Mexico, or show it per person",
          Asked: () => "Pick a choice above, or say what you mean",
          Unanswered: () => "Name what to measure and where",
          Stopped: () => "Ask again, or ask something else",
        })

interface FollowUpProps {
  id: ConversationId
  last: Ending | undefined
  answering: Answering | undefined
  pending: boolean
  ask: (question: string) => void
}

// The composer at the bottom of the lane, docked by the conversation's Scroll.
// Panels about the next question go above the composer.
export const FollowUp = ({ id, last, answering, pending, ask }: FollowUpProps) => {
  const question =
    !pending && answering === undefined && last !== undefined && "choices" in last
      ? last
      : undefined

  return (
    <div className="pb-3 sm:pb-4">
      <Lane>
        <div
          className={
            question === undefined ? undefined : "[&_[data-slot=input-group]]:rounded-t-none"
          }
        >
          {question === undefined ? null : (
            <Choices question={question.question} choices={question.choices} choose={ask} />
          )}
          <QuestionForm
            label="Ask a follow-up"
            placeholder={suggest(last, answering)}
            draft={id}
            answering={answering}
            onAsk={ask}
          />
        </div>
      </Lane>
    </div>
  )
}
