import type { CloudflareWorkersModule, Rpc } from "@cloudflare/workers-types"

// What a build uses of a Workflow's step.
export interface WorkflowStep {
  readonly do: <T extends Rpc.Serializable<T>>(
    name: string,
    config: CloudflareWorkersModule.WorkflowStepConfig,
    callback: () => Promise<T>,
  ) => Promise<T>
  readonly sleep: (name: string, duration: number) => Promise<void>
}
