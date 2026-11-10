import { describe, expect, it } from "@effect/vitest"
import { Context, Data, Deferred, Effect, Fiber, Layer, Option, Ref, Stream } from "effect"

import { Machine } from "../src/index.ts"

// A search box: idle, or looking up a query, or showing what it found.
type Search = Data.TaggedEnum<{
  Idle: {}
  Looking: { readonly query: string }
  Showing: { readonly query: string; readonly result: string }
}>

const Search = Data.taggedEnum<Search>()

type SearchEvent = Data.TaggedEnum<{
  Ask: { readonly query: string }
  Found: { readonly result: string }
  Clear: {}
}>

const SearchEvent = Data.taggedEnum<SearchEvent>()

// Answers a query once the test replies to it, and records the queries whose
// lookup was interrupted.
class Answers extends Context.Service<
  Answers,
  {
    readonly find: (query: string) => Effect.Effect<string>
    readonly reply: (query: string, result: string) => Effect.Effect<void>
    readonly interrupted: Effect.Effect<ReadonlyArray<string>>
  }
>()("test/Answers") {
  static readonly layer = Layer.effect(
    Answers,
    Effect.gen(function* () {
      const pending = new Map<string, Deferred.Deferred<string>>()
      const interrupted = yield* Ref.make<ReadonlyArray<string>>([])

      const waiting = (query: string) =>
        Effect.sync(() => {
          const found = pending.get(query)

          if (found !== undefined) return found

          const made = Deferred.makeUnsafe<string>()

          pending.set(query, made)

          return made
        })

      return Answers.of({
        find: (query) =>
          waiting(query).pipe(
            Effect.flatMap(Deferred.await),
            Effect.onInterrupt(() => Ref.update(interrupted, (queries) => [...queries, query])),
          ),
        reply: (query, result) =>
          waiting(query).pipe(Effect.flatMap((deferred) => Deferred.succeed(deferred, result))),
        interrupted: Ref.get(interrupted),
      })
    }),
  )
}

// Hands back each result it shows.
const search = Machine.make<Search, SearchEvent, string>()({
  initial: () => Search.Idle(),
  on: {
    Idle: {
      Ask: (_, { query }) => Search.Looking({ query }),
      ignore: ["Found", "Clear"],
    },
    Looking: {
      Ask: (_, { query }) => Search.Looking({ query }),
      Found: ({ query }, { result }) => Machine.emit(Search.Showing({ query, result }), result),
      Clear: () => Search.Idle(),
    },
    Showing: {
      Ask: (_, { query }) => Search.Looking({ query }),
      Clear: () => Search.Idle(),
      ignore: ["Found"],
    },
  },
  work: {
    Looking: ({ query }) =>
      Answers.use((answers) => answers.find(query)).pipe(
        Effect.map((result) => SearchEvent.Found({ result })),
      ),
  },
})

describe("next", () => {
  it("moves to the state the handler returns", () => {
    expect(Machine.next(search, Search.Idle(), SearchEvent.Ask({ query: "gdp" }))).toEqual({
      state: Search.Looking({ query: "gdp" }),
      output: Option.none(),
    })
  })

  it("hands back what the handler emits", () => {
    const looking = Search.Looking({ query: "gdp" })

    expect(
      Machine.next(search, looking, SearchEvent.Found({ result: "GDP (current US$)" })),
    ).toEqual({
      state: Search.Showing({ query: "gdp", result: "GDP (current US$)" }),
      output: Option.some("GDP (current US$)"),
    })
  })

  it("leaves the state as it is on an ignored event", () => {
    const idle = Search.Idle()

    expect(Machine.next(search, idle, SearchEvent.Found({ result: "late" })).state).toBe(idle)
  })

  it("rejects a table where a state neither handles nor ignores an event", () => {
    const partial = Machine.make<Search, SearchEvent>()({
      initial: () => Search.Idle(),
      on: {
        Idle: { Ask: (_, { query }) => Search.Looking({ query }), ignore: ["Found", "Clear"] },
        Looking: { Ask: (_, { query }) => Search.Looking({ query }), ignore: ["Found", "Clear"] },
        // @ts-expect-error Showing does nothing with Clear and does not ignore it.
        Showing: { Ask: (_, { query }) => Search.Looking({ query }), ignore: ["Found"] },
      },
    })

    // The table still runs: the check is the compiler's.
    expect(Machine.next(partial, Search.Idle(), SearchEvent.Clear()).state).toEqual(Search.Idle())
  })
})

describe("start", () => {
  it.effect("runs a state's work and handles the event it produces", () =>
    Effect.gen(function* () {
      const answers = yield* Answers
      const actor = yield* Machine.start(search)

      yield* actor.send(SearchEvent.Ask({ query: "gdp" }))
      yield* answers.reply("gdp", "GDP (current US$)")

      const shown = yield* actor.changes.pipe(Stream.filter(Search.$is("Showing")), Stream.runHead)

      expect(shown).toEqual(
        Option.some(Search.Showing({ query: "gdp", result: "GDP (current US$)" })),
      )
    }).pipe(Effect.scoped, Effect.provide(Answers.layer)),
  )

  it.effect("stops a state's work when the machine leaves it, and drops its late result", () =>
    Effect.gen(function* () {
      const answers = yield* Answers
      const actor = yield* Machine.start(search)

      yield* actor.send(SearchEvent.Ask({ query: "gdp" }))
      yield* actor.send(SearchEvent.Clear())
      yield* answers.reply("gdp", "GDP (current US$)")

      expect(yield* answers.interrupted).toEqual(["gdp"])
      expect(yield* actor.get).toEqual(Search.Idle())
    }).pipe(Effect.scoped, Effect.provide(Answers.layer)),
  )

  it.effect("restarts the work when the state changes within the same tag", () =>
    Effect.gen(function* () {
      const answers = yield* Answers
      const actor = yield* Machine.start(search)

      yield* actor.send(SearchEvent.Ask({ query: "gdp" }))
      yield* actor.send(SearchEvent.Ask({ query: "population" }))
      yield* answers.reply("gdp", "GDP (current US$)")
      yield* answers.reply("population", "Population, total")

      const shown = yield* actor.changes.pipe(Stream.filter(Search.$is("Showing")), Stream.runHead)

      expect(yield* answers.interrupted).toEqual(["gdp"])
      expect(shown).toEqual(
        Option.some(Search.Showing({ query: "population", result: "Population, total" })),
      )
    }).pipe(Effect.scoped, Effect.provide(Answers.layer)),
  )

  it.effect("keeps the work running when the state changes but its key does not", () =>
    Effect.gen(function* () {
      const ticks = yield* Deferred.make<void>()

      const counter = Machine.make<Count, CountEvent>()({
        initial: () => Count.Counting({ run: 1, count: 0 }),
        on: {
          Counting: {
            Tick: ({ run, count }) => Count.Counting({ run, count: count + 1 }),
            Done: ({ count }) => Count.Counted({ count }),
          },
          Counted: { ignore: ["Tick", "Done"] },
        },
        work: {
          Counting: {
            key: ({ run }) => run,
            run: () =>
              Stream.make(CountEvent.Tick(), CountEvent.Tick(), CountEvent.Tick()).pipe(
                Stream.concat(
                  Stream.fromEffect(Deferred.await(ticks).pipe(Effect.as(CountEvent.Done()))),
                ),
              ),
          },
        },
      })

      const actor = yield* Machine.start(counter)

      yield* Deferred.succeed(ticks, undefined)

      const counted = yield* actor.changes.pipe(Stream.filter(Count.$is("Counted")), Stream.runHead)

      expect(counted).toEqual(Option.some(Count.Counted({ count: 3 })))
    }).pipe(Effect.scoped),
  )

  it.effect("hands back outputs in order", () =>
    Effect.gen(function* () {
      const answers = yield* Answers
      const actor = yield* Machine.start(search)
      const read = yield* actor.outputs.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)

      yield* actor.send(SearchEvent.Ask({ query: "gdp" }))
      yield* answers.reply("gdp", "GDP (current US$)")
      yield* actor.changes.pipe(Stream.filter(Search.$is("Showing")), Stream.runHead)
      yield* actor.send(SearchEvent.Ask({ query: "population" }))
      yield* answers.reply("population", "Population, total")

      expect(yield* Fiber.join(read)).toEqual(["GDP (current US$)", "Population, total"])
    }).pipe(Effect.scoped, Effect.provide(Answers.layer)),
  )

  it.effect("stops the work when its scope closes", () =>
    Effect.gen(function* () {
      const answers = yield* Answers

      yield* Effect.gen(function* () {
        const actor = yield* Machine.start(search)

        yield* actor.send(SearchEvent.Ask({ query: "gdp" }))
      }).pipe(Effect.scoped)

      expect(yield* answers.interrupted).toEqual(["gdp"])
    }).pipe(Effect.provide(Answers.layer)),
  )
})

// Counts the ticks of one run of work.
type Count = Data.TaggedEnum<{
  Counting: { readonly run: number; readonly count: number }
  Counted: { readonly count: number }
}>

const Count = Data.taggedEnum<Count>()

type CountEvent = Data.TaggedEnum<{
  Tick: {}
  Done: {}
}>

const CountEvent = Data.taggedEnum<CountEvent>()
