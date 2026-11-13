import type { Turn } from "@repo/domain"
import type { Array as Arr, DateTime } from "effect"

import type { Edit } from "./Transcript.schemas.ts"

// What a conversation keeps: the model's chat history as Effect AI exports it,
// the turns shown to people, the charts a person changed since the model last
// heard of them, in the order they changed, and the question being answered,
// if any.
export interface Saved {
  readonly chat: string
  readonly turns: ReadonlyArray<Turn>
  readonly edits?: Arr.NonEmptyReadonlyArray<Edit>
  readonly answering?: { readonly question: string; readonly started: DateTime.Utc }
}

// The writes a save makes in one storage transaction.
export interface Writes {
  readonly put: (key: string, value: string) => Promise<void>
  readonly setAlarm: (time: number) => Promise<void>
}

// The part of a Durable Object's storage a transcript uses. A transaction
// commits all its writes or, when its closure rejects, none of them.
export interface Storage {
  readonly get: (key: string) => Promise<string | undefined>
  readonly put: (key: string, value: string) => Promise<void>
  readonly getAlarm: () => Promise<number | null>
  readonly transaction: (closure: (txn: Writes) => Promise<void>) => Promise<void>
  readonly deleteAll: () => Promise<void>
}
