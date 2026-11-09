// Outside Workers (plain `pnpm dev:web`) there is no Workflows runtime, nor the
// `cloudflare:workers` module CatalogWorkflow extends. The Worker entry still
// exports a class of that name, which nothing runs.
export class CatalogWorkflow {
  run(): never {
    throw new Error("The catalog builds only inside Workers")
  }
}
