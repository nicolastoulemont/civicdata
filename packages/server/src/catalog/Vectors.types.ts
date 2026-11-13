// What the index needs from the Workers AI binding. Its answers are decoded
// before use: the types say what Workers AI documents, not what it sent.
export interface Ai {
  readonly run: (
    name: string,
    input: {
      readonly text: ReadonlyArray<string>
      readonly pooling: "cls"
      readonly truncate_inputs: true
    },
  ) => Promise<{ readonly data: ReadonlyArray<ReadonlyArray<number>> }>
}

// What the index needs from a Vectorize index binding.
export interface Index {
  readonly upsert: (
    vectors: Array<{ readonly id: string; readonly values: ReadonlyArray<number> }>,
  ) => Promise<{ readonly mutationId: string }>
  readonly deleteByIds: (ids: Array<string>) => Promise<{ readonly mutationId: string }>
  readonly query: (
    vector: ReadonlyArray<number>,
    options: { readonly topK: number },
  ) => Promise<{
    readonly matches: ReadonlyArray<{ readonly id: string; readonly score: number }>
  }>
}
