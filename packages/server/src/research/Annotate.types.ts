// What the Workflow uses of the ANNOTATE binding.
export interface AnnotateBinding {
  readonly get: (id: string) => Promise<{
    readonly status: () => Promise<{ readonly status: string }>
  }>
}
