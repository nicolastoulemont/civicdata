import { ConversationId } from "@civicdata/domain"
import { Array, DateTime, Option, Order, Schema } from "effect"
import { useSyncExternalStore } from "react"

// A conversation asked in this browser: its first question as a title, and
// when its last question was asked here.
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

const key = "civicdata:conversations"

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

export const forget = (id: ConversationId) => write(read().filter((entry) => entry.id !== id))
