import type { CloudflareWorkersModule, Rpc } from "@cloudflare/workers-types"
import { Context, Effect, Layer, Schema } from "effect"

// What a step hands back, which Workflows saves: a count, a cursor, a few of
// them or nothing, never rows, so a saved result stays far below its 1 MiB
// limit.
type Saved = number | string | null | void | { readonly [key: string]: number | string | null }

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

// Runs one named step of a build. Workflows saves the result of each step
// that completes; when a build resumes after a failure, a completed step
// answers its saved result instead of running again.
export class Step extends Context.Service<
  Step,
  {
    // A step that waits on many writes, such as gathering a large dataset,
    // may ask for a longer `timeout` than the default five minutes.
    readonly run: <A extends Saved & Rpc.Serializable<A>, E>(
      name: string,
      effect: Effect.Effect<A, E>,
      options?: { readonly timeout?: CloudflareWorkersModule.WorkflowStepConfig["timeout"] },
    ) => Effect.Effect<A, StepFailed>
  }
>()("@civicdata/server/Step") {
  static readonly workflow = (step: CloudflareWorkersModule.WorkflowStep) =>
    Layer.succeed(
      Step,
      Step.of({
        run: (name, effect, options) =>
          Effect.tryPromise({
            try: () =>
              step.do(
                name,
                options?.timeout === undefined ? retried : { ...retried, timeout: options.timeout },
                () => Effect.runPromise(effect),
              ),
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
    }),
  )
}
