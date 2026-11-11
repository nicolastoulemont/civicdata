import type { ConversationId, Ending } from "@civicdata/domain"
import { Match } from "effect"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import { Choices } from "./Choices.tsx"
import { Lane } from "./Lane.tsx"
import { type Answering, QuestionForm } from "./QuestionForm.tsx"

// What to suggest next, from how the agent last answered.
interface SuggestOptions {
  answering: Answering | undefined
  t: TFunction<"conversation">
}

const suggest = (last: Ending | undefined, { answering, t }: SuggestOptions) =>
  answering !== undefined
    ? t(($) => $["Write your next question while openfacts answers"])
    : last === undefined
      ? t(($) => $["How has life expectancy changed in Brazil?"])
      : Match.valueTags(last, {
          Answered: () => t(($) => $["Add Mexico, or show it per person"]),
          Asked: () => t(($) => $["Pick a choice above, or say what you mean"]),
          Unanswered: () => t(($) => $["Name what to measure and where"]),
          Exhausted: () => t(($) => $["Ask again, or ask a narrower question"]),
          Stopped: () => t(($) => $["Ask again, or ask something else"]),
        })

interface FollowUpProps {
  id: ConversationId
  last: Ending | undefined
  answering: Answering | undefined
  ask: (question: string) => void
}

// The composer at the bottom of the lane, docked by the conversation's Scroll.
// Panels about the next question go above the composer.
export const FollowUp = ({ id, last, answering, ask }: FollowUpProps) => {
  const { t } = useTranslation("conversation")

  const question =
    answering === undefined && last !== undefined && "choices" in last ? last : undefined

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
            label={t(($) => $["Ask a follow-up"])}
            placeholder={suggest(last, { answering, t })}
            draft={id}
            answering={answering}
            onAsk={ask}
          />
        </div>
      </Lane>
    </div>
  )
}
