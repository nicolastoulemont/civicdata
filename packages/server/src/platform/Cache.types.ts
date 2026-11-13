// What the cache needs from an R2 bucket binding.
export interface Bucket {
  readonly get: (key: string) => Promise<{ readonly text: () => Promise<string> } | null>
  readonly put: (key: string, value: string) => Promise<{ readonly key: string } | null>
}
