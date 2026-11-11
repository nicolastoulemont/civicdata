import { type Turn, TurnIndex } from "@civicdata/domain"
import { Data } from "effect"

import type { Failure, useConversation } from "./useConversation.ts"

type Pending = NonNullable<ReturnType<typeof useConversation>["pending"]>

// A question in the timeline: one that failed, one answered, or the one
// being answered, at the index its turn takes once kept.
export type Entry = Data.TaggedEnum<{
  Failed: { readonly failure: Failure }
  Turn: { readonly turn: Turn; readonly index: TurnIndex }
  Pending: { readonly pending: Pending; readonly index: TurnIndex }
}>

export const Entry = Data.taggedEnum<Entry>()

interface EntriesInput {
  turns: ReadonlyArray<Turn>
  failures: ReadonlyArray<Failure>
  pending: Pending | undefined
}

// The questions of a conversation, oldest first: each failed question before
// the turn it was asked ahead of, then the one being answered.
export const entries = ({ turns, failures, pending }: EntriesInput): ReadonlyArray<Entry> => [
  ...Array.from({ length: turns.length + 1 }, (_, index) => [
    ...failures
      .filter((failure) => Math.min(failure.before, turns.length) === index)
      .map((failure) => Entry.Failed({ failure })),
    ...(turns[index] === undefined
      ? []
      : [Entry.Turn({ turn: turns[index], index: TurnIndex.make(index) })]),
  ]).flat(),
  ...(pending === undefined
    ? []
    : [Entry.Pending({ pending, index: TurnIndex.make(turns.length) })]),
]
