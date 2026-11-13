import type { CloudflareWorkersModule, Rpc } from "@cloudflare/workers-types"
import { Context, Duration, Effect, Layer, Schema } from "effect"

// What a step hands back, which Workflows saves: a count, a cursor, a few of
// them, whether the build holds the lease, or nothing, never rows, so a
// saved result stays far below its 1 MiB limit.
type Saved =
  | number
  | string
  | boolean
  | null
  | void
  | { readonly [key: string]: number | string | null }

// A step that still failed after its retries.
export class StepFailed extends Schema.TaggedError<StepFailed, { readonly brand: unique symbol }>()(
  "StepFailed",
  {
    step: Schema.String,
    cause: Schema.Defect(),
  },
) {}

// Each step retries alone: about half an hour of retries outlasts the OECD's
// five-minute cooldown after it refuses the Workers' shared IP.
const retried = {
  retries: { limit: 5, delay: "1 minute", backoff: "exponential" },
  timeout: "5 minutes",
} satisfies CloudflareWorkersModule.WorkflowStepConfig

// What a build uses of a Workflow's step.
export interface WorkflowStep {
  readonly do: <T extends Rpc.Serializable<T>>(
    name: string,
    config: CloudflareWorkersModule.WorkflowStepConfig,
    callback: () => Promise<T>,
  ) => Promise<T>
  readonly sleep: (name: string, duration: number) => Promise<void>
}

// Runs one named step of a build. Workflows saves the result of each step
// that completes; when a build resumes after a failure, a completed step
// answers its saved result instead of running again.
export class Step extends Context.Service<
  Step,
  {
    readonly run: <A extends Saved & Rpc.Serializable<A>, E>(
      name: string,
      effect: Effect.Effect<A, E>,
    ) => Effect.Effect<A, StepFailed>
    // Sleeps as one named step: a resumed build skips a sleep that ended.
    readonly sleep: (name: string, duration: Duration.Duration) => Effect.Effect<void, StepFailed>
  }
>()("@repo/server/Step") {
  // A step's body runs with the caller's services, so its spans and logs
  // reach the run's tracer under the span that started the step. Each step
  // retries as `config` says, by default as a build's do.
  static readonly workflow = (
    step: WorkflowStep,
    config: CloudflareWorkersModule.WorkflowStepConfig = retried,
  ) =>
    Layer.succeed(
      Step,
      Step.of({
        run: (name, effect) =>
          Effect.flatMap(Effect.context(), (context) =>
            Effect.tryPromise({
              try: () => step.do(name, config, () => Effect.runPromiseWith(context)(effect)),
              catch: (cause) => new StepFailed({ step: name, cause }),
            }),
          ),
        sleep: (name, duration) =>
          Effect.tryPromise({
            try: () => step.sleep(name, Duration.toMillis(duration)),
            catch: (cause) => new StepFailed({ step: name, cause }),
          }),
      }),
    )

  // Runs each step once, saving nothing: a build outside Workflows, such as
  // the eval's.
  static readonly immediate = Layer.succeed(
    Step,
    Step.of({
      run: (name, effect) =>
        effect.pipe(Effect.mapError((cause) => new StepFailed({ step: name, cause }))),
      sleep: (_name, duration) => Effect.sleep(duration),
    }),
  )
}
