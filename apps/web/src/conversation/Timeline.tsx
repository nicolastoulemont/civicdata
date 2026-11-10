import { Chart, type ConversationId, Rendered, type Step } from "@civicdata/domain"
import { Match, Schema } from "effect"

import { Blocks } from "./Blocks.tsx"
import { Drawing } from "./Drawing.tsx"
import { FailedQuestion, Unstopped } from "./Problem.tsx"
import { Question } from "./Question.tsx"
import { Reply } from "./Reply.tsx"
import { Agent } from "./Row.tsx"
import type { Entry } from "./timeline.ts"
import { Stop, type useConversation } from "./useConversation.ts"
import { Steps, Worked, Working } from "./Work.tsx"

interface ItemProps {
  id: ConversationId
  entry: Entry
  retry: ReturnType<typeof useConversation>["retry"]
  answering: boolean
}

const isRendered = Schema.is(Rendered)
const isChart = Schema.is(Chart)

interface SentProps {
  steps: ReadonlyArray<Step>
}

// The blocks of the answer in progress, as the agent sends them.
const Sent = ({ steps }: SentProps) => {
  const blocks = steps.filter(isRendered).map(({ block }) => block)

  if (blocks.length === 0) return null

  return (
    <Blocks
      blocks={blocks}
      charts={blocks.filter(isChart).map((chart, place) => (
        // oxlint-disable-next-line react/no-array-index-key -- a chart keeps its place in its answer
        <Drawing key={place} chart={chart} />
      ))}
    />
  )
}

// One question and its answer. An answered turn folds the agent's steps under
// its answer; a failed one keeps them open above the problem. The one being
// answered shows each block under the running steps as soon as the agent
// writes it. Each is marked as a question, for the rail to find.
const Item = ({ id, entry, retry, answering }: ItemProps) =>
  Match.valueTags(entry, {
    Failed: ({ failure }) => (
      <li data-question className="flex flex-col gap-4">
        <Question text={failure.question} />
        <Agent>
          {failure.steps.length === 0 ? null : <Steps steps={failure.steps} />}
          <FailedQuestion failure={failure} answering={answering} retry={retry} />
        </Agent>
      </li>
    ),
    Turn: ({ turn, index }) => (
      <li data-question className="flex flex-col gap-4">
        <Question text={turn.question} />
        <Agent>
          {turn.steps === undefined ? null : <Worked steps={turn.steps} took={turn.took} />}
          <Reply id={id} index={index} turn={turn} />
        </Agent>
      </li>
    ),
    Pending: ({ pending }) => (
      <li data-question className="flex flex-col gap-4">
        <Question text={pending.question} />
        <Agent>
          <Working steps={pending.steps} started={pending.started} />
          <Sent steps={pending.steps} />
          {Stop.$is("Failed")(pending.stop) ? <Unstopped /> : null}
        </Agent>
      </li>
    ),
  })

// A question keeps its key while it stays the same kind of row.
const key = (entry: Entry) =>
  Match.valueTags(entry, {
    Failed: ({ failure }) => `failed-${failure.retryAt}`,
    Turn: ({ index }) => `turn-${index}`,
    Pending: () => "pending",
  })

interface TimelineProps {
  id: ConversationId
  entries: ReadonlyArray<Entry>
  retry: ReturnType<typeof useConversation>["retry"]
  answering: boolean
}

// The questions of a conversation, oldest first, then the one being answered.
export const Timeline = ({ id, entries, retry, answering }: TimelineProps) => (
  <ol aria-label="Questions and answers" className="flex flex-col gap-8">
    {entries.map((entry) => (
      <Item key={key(entry)} id={id} entry={entry} retry={retry} answering={answering} />
    ))}
  </ol>
)
