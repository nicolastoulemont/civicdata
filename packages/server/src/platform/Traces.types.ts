import type { Layer } from "effect"

export interface ServeOptions {
  // Where each request's spans go: `layer` unless a test records them.
  readonly tracer?: Layer.Layer<never>
}
