import {
  type Block,
  blocksOf,
  Chart,
  ChartIndex,
  type ConversationId,
  Rendered,
  type Turn,
  type TurnIndex,
} from "@civicdata/domain"
import { Match, Schema } from "effect"

import { Answer } from "./Answer.tsx"
import { Blocks } from "./Blocks.tsx"
import { FailedQuestion, Unstopped } from "./Problem.tsx"
import { Question } from "./Question.tsx"
import { Reply } from "./Reply.tsx"
import { Agent } from "./Row.tsx"
import type { Entry } from "./timeline.ts"
import { Stop, type useConversation } from "./useConversation.ts"
import { runs, Steps, Worked, Working } from "./Work.tsx"

const isRendered = Schema.is(Rendered)
const isChart = Schema.is(Chart)

interface ChartsInput {
  id: ConversationId
  turn: TurnIndex
  blocks: ReadonlyArray<Block>
  shown?: Turn["shown"]
  kept: boolean
}

// Each chart of an answer, in order, drawn as an Answer while the agent
// answers and once the answer is kept alike.
const charts = ({ id, turn, blocks, shown, kept }: ChartsInput) =>
  blocks.filter(isChart).map((chart, place) => (
    <Answer
      // oxlint-disable-next-line react/no-array-index-key -- a chart keeps its place in its answer
      key={place}
      id={id}
      turn={turn}
      chart={ChartIndex.make(place)}
      agent={chart}
      shown={shown?.[place] ?? undefined}
      kept={kept}
    />
  ))

interface ItemProps {
  id: ConversationId
  entry: Entry
  retry: ReturnType<typeof useConversation>["retry"]
  answering: boolean
}

// One question and its answer. The one being answered shows each block as
// soon as the agent writes it, after the steps that led to it, and the steps
// since below. Once it is kept, its steps fold above its answer and the blocks
// stay as they are. A failed one keeps its steps open above the problem. Each
// is marked as a question, for the rail to find.
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
    Turn: ({ turn, index }) => {
      const blocks = blocksOf(turn.answer)

      return (
        <li data-question className="flex flex-col gap-4">
          <Question text={turn.question} />
          <Agent>
            {turn.steps === undefined ? null : <Worked steps={turn.steps} took={turn.took} />}
            <Blocks
              blocks={blocks}
              charts={charts({ id, turn: index, blocks, shown: turn.shown, kept: true })}
              changed={turn.shown?.some((view) => view !== null) ?? false}
            />
            <Reply answer={turn.answer} />
          </Agent>
        </li>
      )
    },
    Pending: ({ pending, index }) => {
      const blocks = pending.steps.filter(isRendered).map(({ block }) => block)

      return (
        <li data-question className="flex flex-col gap-4">
          <Question text={pending.question} />
          <Agent>
            <Working steps={pending.steps} started={pending.started} />
            <Blocks
              blocks={blocks}
              charts={charts({ id, turn: index, blocks, kept: false })}
              work={runs(pending.steps)}
            />
            {Stop.$is("Failed")(pending.stop) ? <Unstopped /> : null}
          </Agent>
        </li>
      )
    },
  })

// A question keeps its key while it stays the same kind of row, and the one
// being answered keeps it once its turn is kept, so its charts stay drawn.
const key = (entry: Entry) =>
  Match.valueTags(entry, {
    Failed: ({ failure }) => `failed-${failure.retryAt}`,
    Turn: ({ index }) => `turn-${index}`,
    Pending: ({ index }) => `turn-${index}`,
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
