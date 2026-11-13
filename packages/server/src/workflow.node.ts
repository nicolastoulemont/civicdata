// Outside Workers (plain `pnpm dev:web`) there is no Workflows runtime, nor the
// `cloudflare:workers` module the Workflows extend. The Worker entry still
// exports classes of these names, which nothing runs.
export class CatalogWorkflow {
  run(): never {
    throw new Error("The catalog builds only inside Workers")
  }
}

export class GatherWorkflow {
  run(): never {
    throw new Error("Series are gathered only inside Workers")
  }
}

export class AnnotateWorkflow {
  run(): never {
    throw new Error("Papers are annotated only inside Workers")
  }
}
