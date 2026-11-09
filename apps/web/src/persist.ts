import { ResolvedView, Turns } from "@civicdata/domain"
import {
  type AsyncStorage,
  experimental_createQueryPersister,
} from "@tanstack/query-persist-client-core"
import {
  notifyManager,
  partialMatchKey,
  type Query,
  type QueryClient,
  type QueryPersister,
} from "@tanstack/react-query"
import { Schema } from "effect"
import { createStore, del, entries, get, set } from "idb-keyval"

// Where saved queries live: IndexedDB in the browser, a fake in tests.
export type Store = AsyncStorage<unknown>

// Bump when a saved shape changes, so older saves are dropped unread.
const buster = "2"

// The server deletes a conversation 30 days after its last question.
const maxAge = 30 * 24 * 60 * 60 * 1000

// One saved query. Its data is encoded as the API sends it, and restoring it
// decodes it like a response: what storage returns is untrusted. The key is
// not saved: its hash is the key as JSON, without undefined fields.
const Entry = <A, I>(data: Schema.Codec<A, I>) =>
  Schema.fromJsonString(
    Schema.toCodecJson(
      Schema.Struct({
        buster: Schema.String,
        queryHash: Schema.String,
        dataUpdatedAt: Schema.Finite,
        data,
      }),
    ),
  )

const decodeKey = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Json)))

// Storage can be blocked, full or cleared at any time. A failed read is a
// miss, and a failed write saves nothing.
const guard = (store: Store): Store => ({
  getItem: async (key) => {
    try {
      return await store.getItem(key)
    } catch {
      return undefined
    }
  },
  setItem: async (key, value) => {
    try {
      await store.setItem(key, value)
    } catch {
      return
    }
  },
  removeItem: async (key) => {
    try {
      await store.removeItem(key)
    } catch {
      return
    }
  },
  entries: async () => {
    try {
      return (await store.entries?.()) ?? []
    } catch {
      return []
    }
  },
})

// Opens IndexedDB, which some browsers refuse outright.
const open = () => {
  try {
    return createStore("civicdata", "queries")
  } catch {
    return undefined
  }
}

// The server renders without IndexedDB, so it saves nothing.
const indexedDb = (): Store | undefined => {
  if (typeof indexedDB === "undefined") return undefined

  const db = open()

  if (db === undefined) return undefined

  return {
    getItem: (key) => get<unknown>(key, db),
    setItem: (key, value) => set(key, value, db),
    removeItem: (key) => del(key, db),
    // Every key this store writes is a string.
    entries: () => entries<string, unknown>(db),
  }
}

interface Kind<A, I> {
  readonly store: Store
  // The first element of the keys of the queries this kind saves.
  readonly name: string
  readonly schema: Schema.Codec<A, I>
  // Whether data may be saved. Data that may not deletes the saved entry.
  readonly keeps?: (data: A) => boolean
  // Whether a restored query asks the server for anything newer.
  readonly refresh?: boolean
}

// Saves the queries keyed under `name` and restores one when a page first asks
// for it, so the page never waits on restoring the rest.
const keep = <A, I>(
  queryClient: QueryClient,
  { store, name, schema, keeps = () => true, refresh = false }: Kind<A, I>,
) => {
  const prefix = `civicdata-${name}`
  const codec = Entry(schema)
  const encode = Schema.encodeUnknownSync(codec)
  // The persister drops an entry that fails to deserialize, so throwing here
  // turns an unreadable or older-shape entry into a miss.
  const decode = Schema.decodeUnknownSync(codec)
  const valid = Schema.is(schema)

  const saved = experimental_createQueryPersister<unknown>({
    storage: store,
    buster,
    maxAge,
    prefix,
    serialize: (entry) =>
      encode({
        buster: entry.buster,
        queryHash: entry.queryHash,
        dataUpdatedAt: entry.state.dataUpdatedAt,
        data: entry.state.data,
      }),
    deserialize: (value) => {
      const entry = decode(value)

      return {
        buster: entry.buster,
        queryHash: entry.queryHash,
        queryKey: decodeKey(entry.queryHash),
        state: {
          data: entry.data,
          dataUpdatedAt: entry.dataUpdatedAt,
          dataUpdateCount: 1,
          error: null,
          errorUpdatedAt: 0,
          errorUpdateCount: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          isInvalidated: false,
          status: "success",
          fetchStatus: "idle",
        },
      }
    },
  })

  const save = (query: Query) => {
    const { data } = query.state

    return valid(data) && keeps(data)
      ? saved.persistQuery(query).catch(() => undefined)
      : store.removeItem(`${prefix}-${query.queryHash}`)
  }

  // The persister's own function saves after every fetch. This one saves only
  // data `keeps` accepts.
  const persister: QueryPersister = async (queryFn, context, query) => {
    if (query.state.data === undefined) {
      const restored = await saved.retrieveQuery(query.queryHash, (entry) => {
        query.setState({ dataUpdatedAt: entry.state.dataUpdatedAt })

        if (refresh) void query.fetch().catch(() => undefined)
      })

      if (restored !== undefined) return restored
    }

    const data = await queryFn(context)

    notifyManager.schedule(() => void save(query))

    return data
  }

  queryClient.setQueryDefaults([name], { persister })

  // Data the page sets itself, such as an answer that just ended, is saved too.
  queryClient.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      event.action.manual === true &&
      partialMatchKey(event.query.queryKey, [name])
    ) {
      void save(event.query)
    }
  })

  // Drops expired and unreadable entries, such as charts no page asks for.
  void saved.persisterGc()
}

// Saves conversations and charts in this browser, so a conversation opened
// before shows at once.
export const persist = (queryClient: QueryClient, store = indexedDb()) => {
  if (store === undefined) return

  const guarded = guard(store)

  keep(queryClient, {
    store: guarded,
    name: "conversation",
    schema: Turns,
    // Only finished turns are saved. A conversation being answered, or one
    // with no turns (new, or deleted by the server), loses its entry.
    keeps: ({ answered, answering }) => answering === undefined && answered.length > 0,
    // The conversation may have moved on in another tab.
    refresh: true,
  })

  keep(queryClient, { store: guarded, name: "resolve", schema: ResolvedView })
}
