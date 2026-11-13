import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { Effect } from "effect"

import { type WorkflowStep, Step } from "../src/CatalogBuild.ts"

// Workflows' side of each step: saves a step's result by name, answers a
// saved one without running it again, and retries a throwing body as its
// config says, without waiting. `crash` hangs the step of that name, as an
// instance that stopped there; `lose` runs that step once, then throws as
// if Workflows lost its result. `before` runs ahead of each step. The same
// steps again stand for the instance restarted from its failed step.
// Each step retries as `config` says, by default as a build's do.
export const workflow = (
  options: {
    crash?: string | undefined
    lose?: string
    before?: (name: string) => Promise<void>
    config?: CloudflareWorkersModule.WorkflowStepConfig
  } = {},
) => {
  const saved = new Map<string, unknown>()
  const calls = new Map<string, number>()
  const crashed = Promise.withResolvers<void>()
  let lost = false

  // One attempt at a step's body. The first attempt at `lose` throws after
  // its body ran.
  const attempt = async <T>(name: string, callback: () => Promise<T>) => {
    calls.set(name, (calls.get(name) ?? 0) + 1)

    const result = await callback()

    if (name === options.lose && !lost) {
      lost = true
      throw new Error(`Workflows lost the result of ${name}`)
    }

    saved.set(name, result)

    return result
  }

  // An attempt, then up to `left` more while each one throws.
  const retrying = async <T>(
    name: string,
    { callback, left }: { callback: () => Promise<T>; left: number },
  ): Promise<T> => {
    try {
      return await attempt(name, callback)
    } catch (error) {
      if (left === 0) throw error

      return await retrying(name, { callback, left: left - 1 })
    }
  }

  const step: WorkflowStep = {
    do: async (name, config, callback) => {
      if (saved.has(name)) {
        // SAFETY: a step's name fixes what it answers, as in Workflows.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY
        return saved.get(name) as Awaited<ReturnType<typeof callback>>
      }

      await options.before?.(name)

      if (name === options.crash) {
        crashed.resolve()

        return await new Promise<never>(() => {})
      }

      return await retrying(name, { callback, left: config.retries?.limit ?? 0 })
    },
    sleep: () => Promise.resolve(),
  }

  return {
    calls: (prefix: string) =>
      [...calls].filter(([name]) => name.startsWith(prefix)).reduce((all, [, n]) => all + n, 0),
    crashed: Effect.promise(() => crashed.promise),
    // The crashed step runs normally from now on.
    revive: () => {
      options.crash = undefined
    },
    layer: Step.workflow(step, options.config),
  }
}
