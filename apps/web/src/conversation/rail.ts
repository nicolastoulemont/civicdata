import { Text } from "@civicdata/domain"
import { Match, Schema } from "effect"

import { explain } from "./Problem.tsx"
import type { Entry } from "./timeline.ts"

const isText = Schema.is(Text)

// What the rail's card shows for a question: the question, and the start of
// its answer when there is one to show.
export interface Preview {
  readonly question: string
  readonly answer: string | undefined
}

// The start of an answer is the first thing the agent wrote, the agent's
// question back, or how the answer ended.
export const preview = (entry: Entry): Preview =>
  Match.valueTags(entry, {
    Failed: ({ failure }) => ({
      question: failure.question,
      answer: explain(failure.error).title,
    }),
    Turn: ({ turn }) => ({
      question: turn.question,
      answer: Match.valueTags(turn.answer, {
        Answered: ({ blocks }) => blocks.find(isText)?.text,
        Asked: ({ question }) => question,
        Unanswered: () => "No data found",
        Exhausted: () => "Cut short",
        Stopped: () => "Stopped",
      }),
    }),
    Pending: ({ pending }) => ({ question: pending.question, answer: "Answering…" }),
  })

// The questions in view: the first and last of them, by place.
export interface Seen {
  readonly first: number
  readonly last: number
}

// The questions in view, from the tops of the questions measured from the top
// of the viewport, and where the composer starts: those that start in view,
// or else the one whose answer fills it.
export const inView = (tops: ReadonlyArray<number>, bottom: number): Seen => {
  const first = tops.findIndex((top) => top >= 0 && top < bottom)

  if (first === -1) {
    const filling = Math.max(
      0,
      tops.findLastIndex((top) => top < 0),
    )

    return { first: filling, last: filling }
  }

  return { first, last: tops.findLastIndex((top) => top < bottom) }
}
