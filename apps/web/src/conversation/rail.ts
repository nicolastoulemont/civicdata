import { Match } from "effect"

import { explain } from "./Problem.tsx"
import type { Entry } from "./timeline.ts"

// What the rail's card shows for a question: the question, and the start of
// its answer when there is one to show.
export interface Preview {
  readonly question: string
  readonly answer: string | undefined
}

// The start of an answer is the first chart's takeaway, the agent's question
// back, or how the answer ended.
export const preview = (entry: Entry): Preview =>
  Match.valueTags(entry, {
    Failed: ({ failure }) => ({
      question: failure.question,
      answer: explain(failure.error).title,
    }),
    Turn: ({ turn }) => ({
      question: turn.question,
      answer: Match.valueTags(turn.answer, {
        Answered: ({ charts }) => charts[0].takeaway,
        Asked: ({ question }) => question,
        Unanswered: () => "No data found",
        Stopped: () => "Stopped",
      }),
    }),
    Pending: ({ pending }) => ({ question: pending.question, answer: "Answering…" }),
  })

// The question in view, from the tops of the questions measured from the top
// of the viewport, and where the composer starts: the first question that
// starts in view, or else the one whose answer fills it.
export const inView = (tops: ReadonlyArray<number>, bottom: number) => {
  const shown = tops.findIndex((top) => top >= 0 && top < bottom)

  if (shown !== -1) return shown

  return Math.max(
    0,
    tops.findLastIndex((top) => top < 0),
  )
}
