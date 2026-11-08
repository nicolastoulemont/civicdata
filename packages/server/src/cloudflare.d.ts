// The parts of the Workers runtime this package uses. Bindings are optional:
// outside Workers (plain `pnpm dev`) the module does not exist at all.
declare module "cloudflare:workers" {
  export const env: {
    readonly CACHE?: import("./Cache.ts").Bucket
    readonly DB?: import("@cloudflare/workers-types").D1Database
    readonly ASK_LIMIT?: {
      readonly limit: (options: { readonly key: string }) => Promise<{ readonly success: boolean }>
    }
    readonly OPENAI_API_KEY?: string
    readonly OPENAI_MODEL?: string
  }
}
