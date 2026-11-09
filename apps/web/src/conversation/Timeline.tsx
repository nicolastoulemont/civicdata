import type { Turn } from "@civicdata/domain"

import { Problem } from "./Problem.tsx"
import { Question } from "./Question.tsx"
import { Reply } from "./Reply.tsx"
import { Agent } from "./Row.tsx"
import type { useConversation } from "./useConversation.ts"
import { Work } from "./Work.tsx"

// The turns of a conversation, oldest first, then the one being answered.
// Only the last answer's choices can still be picked, and none while the
// agent answers.
export const Timeline = ({
  turns,
  pending,
  answering,
  ask,
}: {
  turns: ReadonlyArray<Turn>
  pending: ReturnType<typeof useConversation>["pending"]
  answering: boolean
  ask: (question: string) => void
}) => (
  <ol aria-label="Questions and answers" className="flex flex-col gap-8">
    {turns.map((turn, index) => (
      // oxlint-disable-next-line react/no-array-index-key -- turns are only appended, so a position never changes meaning
      <li key={index} className="flex flex-col gap-4">
        <Question text={turn.question} />
        <Agent>
          <Reply
            answer={turn.answer}
            disabled={index < turns.length - 1 || pending !== undefined}
            choose={ask}
          />
        </Agent>
      </li>
    ))}
    {pending === undefined ? null : (
      <li className="flex flex-col gap-4">
        {pending.question === undefined ? null : <Question text={pending.question} />}
        <Agent>
          <Work steps={pending.steps} answering={answering} />
          {pending.error === undefined ? null : <Problem error={pending.error} />}
        </Agent>
      </li>
    )}
  </ol>
)
