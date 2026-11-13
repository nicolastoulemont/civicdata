// The Workflow classes the Worker hosts. Workers only: package.json resolves
// `@repo/server/workflow` to `workflow.node.ts` outside workerd.
export { CatalogWorkflow } from "./CatalogWorkflow.ts"

export { GatherWorkflow } from "./GatherWorkflow.ts"

export { AnnotateWorkflow } from "./AnnotateWorkflow.ts"

export { PaperGatherWorkflow } from "./PaperGatherWorkflow.ts"
