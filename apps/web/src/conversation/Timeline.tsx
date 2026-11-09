import type { Turn } from "@civicdata/domain"
import { Fragment } from "react"

import { FailedQuestion } from "./Problem.tsx"
import { Question } from "./Question.tsx"
import { Reply } from "./Reply.tsx"
import { Agent } from "./Row.tsx"
import type { useConversation } from "./useConversation.ts"
import { Work } from "./Work.tsx"

interface TimelineProps {
  turns: ReadonlyArray<Turn>
  pending: ReturnType<typeof useConversation>["pending"]
  failures: ReturnType<typeof useConversation>["failures"]
  retry: ReturnType<typeof useConversation>["retry"]
  answering: boolean
}

// The turns of a conversation, oldest first, then the one being answered.
export const Timeline = ({ turns, pending, failures, retry, answering }: TimelineProps) => (
  <ol aria-label="Questions and answers" className="flex flex-col gap-8">
    {Array.from({ length: turns.length + 1 }, (_, index) => (
      // oxlint-disable-next-line react/no-array-index-key -- positions track append-only answered turns
      <Fragment key={index}>
        {failures
          .filter((failure) => Math.min(failure.before, turns.length) === index)
          .map((failure) => (
            <li key={failure.retryAt} className="flex flex-col gap-4">
              <Question text={failure.question} />
              <Agent>
                <FailedQuestion failure={failure} answering={answering} retry={retry} />
              </Agent>
            </li>
          ))}
        {turns[index] === undefined ? null : (
          <li className="flex flex-col gap-4">
            <Question text={turns[index].question} />
            <Agent>
              <Reply answer={turns[index].answer} />
            </Agent>
          </li>
        )}
      </Fragment>
    ))}
    {pending === undefined ? null : (
      <li data-scroll-anchor className="flex flex-col gap-4">
        {pending.question === undefined ? null : <Question text={pending.question} />}
        <Agent>
          <Work steps={pending.steps} answering={answering} />
        </Agent>
      </li>
    )}
  </ol>
)
