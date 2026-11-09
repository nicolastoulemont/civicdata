import { type ConversationId, Drawn, type Turn, TurnIndex } from "@civicdata/domain"
import { Schema } from "effect"
import { Fragment } from "react"

import { Charts } from "./Charts.tsx"
import { Drawing } from "./Drawing.tsx"
import { FailedQuestion } from "./Problem.tsx"
import { Question } from "./Question.tsx"
import { Reply } from "./Reply.tsx"
import { Agent } from "./Row.tsx"
import type { useConversation } from "./useConversation.ts"
import { Steps, Worked, Working } from "./Work.tsx"

interface TimelineProps {
  id: ConversationId
  turns: ReadonlyArray<Turn>
  pending: ReturnType<typeof useConversation>["pending"]
  failures: ReturnType<typeof useConversation>["failures"]
  retry: ReturnType<typeof useConversation>["retry"]
  answering: boolean
}

const isDrawn = Schema.is(Drawn)

// The turns of a conversation, oldest first, then the one being answered.
// An answered turn folds the agent's steps under its answer; a failed one
// keeps them open above the problem. The one being answered shows each chart
// under the running steps as soon as the agent draws it.
export const Timeline = ({ id, turns, pending, failures, retry, answering }: TimelineProps) => (
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
                {failure.steps.length === 0 ? null : <Steps steps={failure.steps} />}
                <FailedQuestion failure={failure} answering={answering} retry={retry} />
              </Agent>
            </li>
          ))}
        {turns[index] === undefined ? null : (
          <li className="flex flex-col gap-4">
            <Question text={turns[index].question} />
            <Agent>
              {turns[index].steps === undefined ? null : (
                <Worked steps={turns[index].steps} took={turns[index].took} />
              )}
              <Reply id={id} index={TurnIndex.make(index)} turn={turns[index]} />
            </Agent>
          </li>
        )}
      </Fragment>
    ))}
    {pending === undefined ? null : (
      <li data-scroll-anchor className="flex flex-col gap-4">
        <Question text={pending.question} />
        <Agent>
          <Working steps={pending.steps} started={pending.started} />
          {pending.steps.some(isDrawn) ? (
            <Charts
              charts={pending.steps.filter(isDrawn).map((step) => (
                <Drawing key={step.id} step={step} />
              ))}
            />
          ) : null}
        </Agent>
      </li>
    )}
  </ol>
)
