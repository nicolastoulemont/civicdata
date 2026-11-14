import { Source } from "@repo/domain"
import { Schema } from "effect"

// A host the paper gather asks (research/Gather.ts), by its hostname. A
// hostname has a dot and a source name never does, so one limiter's name
// never stands for both.
export const Host = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/))

// What one limiter paces: a series source, or a host the paper gather asks.
export const Key = Schema.Union([Source, Host])

export type Key = typeof Key.Type

// What a source's limiter remembers: when it let each recent request go,
// oldest first, and until when the source is refusing us.
export const Ledger = Schema.Struct({
  sent: Schema.Array(Schema.Finite),
  blockedUntil: Schema.Finite,
})

export interface Ledger extends Schema.Schema.Type<typeof Ledger> {}

// A limiter's answer: the request may go after `wait` milliseconds, or the
// next free slot is further away than the caller is willing to wait.
export const Slot = Schema.TaggedUnion({
  Granted: { wait: Schema.Finite },
  Full: { wait: Schema.Finite },
})

export type Slot = typeof Slot.Type
