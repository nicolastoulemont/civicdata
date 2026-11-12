import { ConversationId } from "@openfacts/domain"
import { Array, DateTime, Option, Order, Schema, Struct } from "effect"
import { useSyncExternalStore } from "react"

import { save } from "@/conversation/draft"

// A conversation asked in this browser: its first question as a title, or the
// title it was renamed to, and when its last question was asked here.
const Entry = Schema.Struct({
  id: ConversationId,
  title: Schema.String,
  askedAt: Schema.DateTimeUtc,
})

export interface Entry extends Schema.Schema.Type<typeof Entry> {}

// Stored as JSON in localStorage, never sent anywhere: a conversation's id is
// what grants access to it.
const Entries = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Entry)))

const newest = Order.flip(Order.mapInput(DateTime.Order, (entry: Entry) => entry.askedAt))

const decode = Schema.decodeUnknownOption(Entries)
const encode = Schema.encodeSync(Entries)

const key = "openfacts:conversations"

const none: ReadonlyArray<Entry> = []

// Browsers that block storage throw on any access, so every read and write is
// guarded: without storage the list is empty and recording does nothing.
const load = () => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// The last value read and its entries, newest question first, so React gets
// the same array until the stored value changes.
interface Read {
  readonly raw: string | null
  readonly entries: ReadonlyArray<Entry>
}

let last: Read = { raw: null, entries: none }

const read = () => {
  const raw = load()

  if (raw !== last.raw) {
    last = {
      raw,
      entries:
        raw === null
          ? none
          : Array.sort(
              Option.getOrElse(decode(raw), () => none),
              newest,
            ),
    }
  }

  return last.entries
}

const listeners = new Set<() => void>()

const write = (entries: ReadonlyArray<Entry>) => {
  try {
    localStorage.setItem(key, encode(entries))
  } catch {
    return
  }

  for (const listener of listeners) listener()
}

// Other tabs change the list through the `storage` event.
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

// The server renders no list: storage lives in the browser.
export const useEntries = () => useSyncExternalStore(subscribe, read, () => none)

// Moves a conversation to the top of the list as `question` is asked in it.
// The first question asked stays its title.
export const record = (id: ConversationId, question: string) => {
  const entries = read()
  const title = entries.find((entry) => entry.id === id)?.title ?? question

  write([
    { id, title, askedAt: DateTime.nowUnsafe() },
    ...entries.filter((entry) => entry.id !== id),
  ])
}

// Gives a conversation the title `text`, trimmed, without moving it in the
// list. A blank title keeps the one it had.
export const rename = (id: ConversationId, text: string) => {
  const title = text.trim()

  if (title === "") return

  write(read().map((entry) => (entry.id === id ? Struct.assign(entry, { title }) : entry)))
}

// Drops a conversation from this browser's list, and the draft typed in it.
// The server keeps it until it deletes it.
export const forget = (id: ConversationId) => {
  save(id, "")
  write(read().filter((entry) => entry.id !== id))
}
