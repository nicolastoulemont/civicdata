import {
  Effect,
  Equal,
  FiberHandle,
  Option,
  Predicate,
  Queue,
  type Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"

// A state machine: the state it starts in, what each state does with each
// event, and the work each state runs while the machine is in it.
//
// Transitions are pure. Effects live in work, which starts when the machine
// enters a state and is interrupted when it leaves, so a result that arrives
// late never reaches a later state.

export interface Tagged {
  readonly _tag: string
}

// A machine dispatches on tags, which the rest of the app reads only through
// Match.
// oxlint-disable-next-line no-underscore-dangle -- the one place tags are read
const tagOf = ({ _tag }: Tagged) => _tag

type Of<A extends Tagged, Tag> = Extract<A, { readonly _tag: Tag }>

// The next state, with an output for whoever owns the actor: a value the
// machine hands back rather than a state it keeps.
export class Emit<S, O> {
  readonly state: S
  readonly output: O

  constructor(state: S, output: O) {
    this.state = state
    this.output = output
  }
}

export const emit = <S, O>(state: S, output: O): Emit<S, O> => new Emit(state, output)

type Handler<S extends Tagged, E extends Tagged, O, K, L> = (
  state: Of<S, K>,
  event: Of<E, L>,
) => S | Emit<S, O>

// What one state does with each event. An event the state does nothing with
// is listed in `ignore`; `make` rejects a table where a state neither handles
// nor ignores an event.
export type Handlers<S extends Tagged, E extends Tagged, O, K> = {
  readonly [L in E["_tag"]]?: Handler<S, E, O, K, L>
} & { readonly ignore?: ReadonlyArray<E["_tag"]> }

export type Table<S extends Tagged, E extends Tagged, O> = {
  readonly [K in S["_tag"]]: Handlers<S, E, O, K>
}

type Ignored<H> = H extends { readonly ignore: ReadonlyArray<infer Tag> } ? Tag : never

type Unhandled<E extends Tagged, H> = Exclude<E["_tag"], Exclude<keyof H, "ignore"> | Ignored<H>>

// Each state that misses an event must name it, so the compiler reports
// `{ unhandled: "Cancel" }` on that state.
type Covered<E extends Tagged, On> = {
  readonly [K in keyof On]: [Unhandled<E, On[K]>] extends [never]
    ? On[K]
    : { readonly unhandled: Unhandled<E, On[K]> }
}

// Work produces the machine's next events: one, from an effect, or many,
// from a stream. It sees the state it runs for and the actor's input. Its
// errors come back as events, so it cannot fail.
export type Run<State, E, R, Input> = (
  state: State,
  input: Input,
) => Effect.Effect<E, never, R> | Stream.Stream<E, never, R>

// What keeps a state's work running: a value compared with Equal.equals.
export type Key = string | number | boolean | bigint | Equal.Equal | ReadonlyArray<Key>

// By default a state's work restarts whenever a handler returns a new state;
// a handler that returns the state it got leaves it running. A state that
// collects progress from its own work names what restarts it with `key`.
export type Job<State, E, R, Input> =
  | Run<State, E, R, Input>
  | { readonly key: (state: State) => Key; readonly run: Run<State, E, R, Input> }

export type Work<S extends Tagged, E extends Tagged, R, Input> = {
  readonly [K in S["_tag"]]?: Job<Of<S, K>, E, R, Input>
}

export interface Machine<Input, S extends Tagged, E extends Tagged, O, R> {
  readonly initial: (input: Input) => S
  readonly on: Table<S, E, O>
  readonly work: Work<S, E, R, Input>
}

interface Spec<Input, S extends Tagged, E extends Tagged, R, On> {
  readonly initial: (input: Input) => S
  readonly on: On & Covered<E, On>
  readonly work?: Work<S, E, R, Input>
}

// Takes the state, event and output types first, so the table and the work
// infer from them.
export const make =
  <S extends Tagged, E extends Tagged, O = never>() =>
  <const On extends Table<S, E, O>, Input = void, R = never>(
    spec: Spec<Input, S, E, R, On>,
  ): Machine<Input, S, E, O, R> => ({
    initial: spec.initial,
    on: spec.on,
    work: spec.work ?? {},
  })

export interface Next<S, O> {
  readonly state: S
  readonly output: Option.Option<O>
}

// A table seen from outside: handlers looked up by tag.
type Lookup<S, E, O> = Readonly<
  Partial<Record<string, Readonly<Partial<Record<string, (state: S, event: E) => S | Emit<S, O>>>>>>
>

const handlerOf = <S extends Tagged, E extends Tagged, O>(
  table: Table<S, E, O>,
  state: S,
  event: E,
) => {
  // SAFETY: the table is keyed by tag, so the handler found under a state's
  // tag and an event's tag takes exactly that state and that event. An event
  // tagged "ignore" would clash with the `ignore` list, so no table has one.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY
  const lookup = table as Lookup<S, E, O>

  return lookup[tagOf(state)]?.[tagOf(event)]
}

// What the machine does with an event in a state: its next state, and the
// output it hands back, if any. An event the state ignores leaves it as is.
export const next = <Input, S extends Tagged, E extends Tagged, O, R>(
  machine: Machine<Input, S, E, O, R>,
  state: S,
  event: E,
): Next<S, O> => {
  const handler = handlerOf(machine.on, state, event)
  const result = handler === undefined ? state : handler(state, event)

  return result instanceof Emit
    ? { state: result.state, output: Option.some(result.output) }
    : { state: result, output: Option.none() }
}

// The work a state runs, and its key: none when any new state restarts it.
interface Running<S, E, R, Input> {
  readonly key: Option.Option<Key>
  readonly run: Run<S, E, R, Input>
}

const jobOf = <Input, S extends Tagged, E extends Tagged, O, R>(
  machine: Machine<Input, S, E, O, R>,
  state: S,
): Running<S, E, R, Input> | undefined => {
  // SAFETY: work is keyed by tag, so the job found under a state's tag takes
  // exactly that state.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY
  const work = machine.work as Readonly<Partial<Record<string, Job<S, E, R, Input>>>>
  const job = work[tagOf(state)]

  if (job === undefined) return undefined

  return Predicate.isFunction(job)
    ? { key: Option.none(), run: job }
    : { key: Option.some(job.key(state)), run: job.run }
}

// Whether moving to a new state keeps the work running: a state of the same
// tag whose work names the same key.
const keeps = <Input, S extends Tagged, E extends Tagged, O, R>(
  machine: Machine<Input, S, E, O, R>,
  previous: S,
  state: S,
) => {
  if (tagOf(previous) !== tagOf(state)) return false

  const before = jobOf(machine, previous)
  const after = jobOf(machine, state)

  if (before === undefined || after === undefined) return true

  return Option.isSome(before.key) && Option.isSome(after.key)
    ? Equal.equals(before.key.value, after.key.value)
    : false
}

export interface Actor<S, E, O> {
  readonly get: Effect.Effect<S>
  // The current state, then every state after it.
  readonly changes: Stream.Stream<S>
  // Every output, in order, for one reader.
  readonly outputs: Stream.Stream<O>
  // Resolves with the state after the event.
  readonly send: (event: E) => Effect.Effect<S>
}

interface Letter<E> {
  readonly event: E
  readonly from: number
}

const run = Effect.fnUntraced(function* <Input, S extends Tagged, E extends Tagged, O, R>(
  machine: Machine<Input, S, E, O, R>,
  input: Input,
) {
  const initial = machine.initial(input)
  const state = yield* SubscriptionRef.make(initial)
  const outputs = yield* Queue.unbounded<O>()
  const mailbox = yield* Queue.unbounded<Letter<E>>()
  const handle = yield* FiberHandle.make()
  const lock = yield* Semaphore.make(1)
  const context = yield* Effect.context<R>()
  // Counts the work started, so an event from earlier work is dropped.
  let generation = 0

  const begin = (entered: S) => {
    generation += 1

    const from = generation
    const job = jobOf(machine, entered)

    if (job === undefined) return FiberHandle.clear(handle)

    const produced = job.run(entered, input)
    const events = Stream.isStream(produced) ? produced : Stream.fromEffect(produced)

    return events.pipe(
      Stream.runForEach((event) => Queue.offer(mailbox, { event, from })),
      Effect.provideContext(context),
      FiberHandle.run(handle),
      Effect.asVoid,
    )
  }

  const transition = Effect.fnUntraced(function* (event: E) {
    const previous = yield* SubscriptionRef.get(state)
    const result = next(machine, previous, event)

    if (Option.isSome(result.output)) yield* Queue.offer(outputs, result.output.value)

    // States compare by reference: a state may hold values, such as errors,
    // that cannot be compared by value.
    if (previous !== result.state) {
      yield* SubscriptionRef.set(state, result.state)

      if (!keeps(machine, previous, result.state)) yield* begin(result.state)
    }

    return result.state
  })

  const send = (event: E) =>
    transition(event).pipe(Effect.uninterruptible, Semaphore.withPermit(lock))

  // The generation is read under the lock: a transition may start new work
  // between the letter's arrival and its turn. A handler that throws is
  // logged, and the machine goes on with the next event.
  const deliver = ({ event, from }: Letter<E>) =>
    Effect.suspend(() => (from === generation ? transition(event) : Effect.void)).pipe(
      Effect.catchDefect((defect) => Effect.logError("Machine event not handled", defect)),
      Effect.uninterruptible,
      Semaphore.withPermit(lock),
    )

  yield* Queue.take(mailbox).pipe(Effect.flatMap(deliver), Effect.forever, Effect.forkScoped)

  yield* begin(initial).pipe(Semaphore.withPermit(lock))

  return {
    get: SubscriptionRef.get(state),
    changes: SubscriptionRef.changes(state),
    outputs: Stream.fromQueue(outputs),
    send,
  } satisfies Actor<S, E, O>
})

// Starts a machine. The actor lives as long as the scope; closing it stops
// the work. Events are handled one at a time, whether sent or produced by
// work, and an event from work that ended since is dropped.
export function start<S extends Tagged, E extends Tagged, O, R>(
  machine: Machine<void, S, E, O, R>,
): Effect.Effect<Actor<S, E, O>, never, R | Scope.Scope>
export function start<Input, S extends Tagged, E extends Tagged, O, R>(
  machine: Machine<Input, S, E, O, R>,
  input: Input,
): Effect.Effect<Actor<S, E, O>, never, R | Scope.Scope>
export function start<Input, S extends Tagged, E extends Tagged, O, R>(
  machine: Machine<Input, S, E, O, R>,
  input?: Input,
): Effect.Effect<Actor<S, E, O>, never, R | Scope.Scope> {
  // SAFETY: `input` is missing only under the first overload, for a machine
  // whose input is void.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY
  return run(machine, input as Input)
}
