import { Machine } from "@openfacts/machine"
import { Effect, Equal, Fiber, Stream } from "effect"
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"

import { traced } from "@/traces"

interface Options<Input, O> {
  readonly input: Input
  // Called with each output, the latest callback each time.
  readonly on?: (output: O) => void
}

interface Snapshot<Input, S> {
  readonly input: Input
  readonly state: S
}

type Send<E> = (event: E) => void

// Runs a machine for as long as the component shows it, and for one input:
// an input that is not Equal to the last one starts the machine again from
// its initial state, and stops the work of the previous one. The page renders
// the initial state on the server, where no work runs. Work runs with the
// page's tracer (traces.ts).
export function useMachine<S extends Machine.Tagged, E extends Machine.Tagged, O>(
  machine: Machine.Machine<void, S, E, O, never>,
  options?: Partial<Options<void, O>>,
): readonly [S, Send<E>]
export function useMachine<Input, S extends Machine.Tagged, E extends Machine.Tagged, O>(
  machine: Machine.Machine<Input, S, E, O, never>,
  options: Options<Input, O>,
): readonly [S, Send<E>]
export function useMachine<Input, S extends Machine.Tagged, E extends Machine.Tagged, O>(
  machine: Machine.Machine<Input, S, E, O, never>,
  options?: Partial<Options<Input, O>>,
): readonly [S, Send<E>] {
  // SAFETY: `input` is missing only under the first overload, for a machine
  // whose input is void.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY
  const input = options?.input as Input

  const [snapshot, setSnapshot] = useState<Snapshot<Input, S>>(() => ({
    input,
    state: machine.initial(input),
  }))

  // A new input resets the state while this render runs, so no render shows
  // the previous input's state with the new input.
  const current: Snapshot<Input, S> = Equal.equals(snapshot.input, input)
    ? snapshot
    : { input, state: machine.initial(input) }

  if (current !== snapshot) setSnapshot(current)

  // The input the actor runs for: the same object for as long as the input
  // stays Equal, so the actor keeps running.
  const started = current.input
  const actor = useRef<Machine.Actor<S, E, O> | undefined>(undefined)
  const output = useEffectEvent((value: O) => options?.on?.(value))

  useEffect(() => {
    const show = (state: S) =>
      Effect.sync(() =>
        setSnapshot((previous) =>
          previous.input === started ? { input: started, state } : previous,
        ),
      )

    const fiber = Machine.start(machine, started).pipe(
      Effect.tap((running) =>
        Effect.sync(() => {
          actor.current = running
        }),
      ),
      Effect.tap((running) =>
        running.outputs.pipe(
          Stream.runForEach((value) => Effect.sync(() => output(value))),
          Effect.forkScoped,
        ),
      ),
      Effect.flatMap((running) => running.changes.pipe(Stream.runForEach(show))),
      Effect.scoped,
      (work) => traced().runFork(work),
    )

    return () => {
      actor.current = undefined
      traced().runFork(Fiber.interrupt(fiber))
    }
  }, [machine, started])

  // Events sent before the actor starts, or after it stops, are dropped.
  const send = useCallback((event: E) => {
    const running = actor.current

    if (running !== undefined) traced().runFork(running.send(event))
  }, [])

  return [current.state, send]
}
