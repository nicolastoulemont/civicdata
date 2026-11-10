// The parts of the Workers runtime this package uses. Bindings are optional:
// outside Workers (plain `pnpm dev`) the module does not exist at all.
type DurableObjectId = import("@cloudflare/workers-types").DurableObjectId

declare module "cloudflare:workers" {
  export const WorkflowEntrypoint: typeof import("@cloudflare/workers-types").CloudflareWorkersModule.WorkflowEntrypoint
  export const env: {
    readonly CACHE?: import("./Cache.ts").Bucket
    // Every stored series, filled by GatherWorkflow (Store.ts).
    readonly SERIES?: import("./Store.ts").SeriesBucket
    readonly DB?: import("@cloudflare/workers-types").D1Database
    readonly AI?: import("./Vectors.ts").Ai
    readonly VECTORS?: import("./Vectors.ts").Index
    readonly ASK_LIMIT?: {
      readonly limit: (options: { readonly key: string }) => Promise<{ readonly success: boolean }>
    }
    readonly CONVERSATION?: {
      readonly idFromName: (name: string) => DurableObjectId
      readonly get: (id: DurableObjectId) => {
        readonly fetch: (request: Request) => Promise<Response>
      }
    }
    // One PaceObject per source, named by it.
    readonly PACE?: import("./Pace.ts").Namespace
    // The sources' answers the agent eval replays, served from disk by
    // vitest.eval.config.ts. Only the eval has it.
    readonly RECORDINGS?: { readonly fetch: (request: Request) => Promise<Response> }
    readonly OPENAI_API_KEY?: string
    readonly OPENAI_MODEL?: string
  }
}
