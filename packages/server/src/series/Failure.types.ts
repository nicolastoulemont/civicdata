import type { SourceUnavailable } from "@repo/domain"
import type { Cause, Schema } from "effect"
import type { HttpClientError } from "effect/http"

// What a request to a source can end with: the client's error, our deadline,
// a body that does not decode, or an adapter's own SourceUnavailable.
export type Ended =
  | HttpClientError.HttpClientError
  | Cause.TimeoutError
  | Schema.SchemaError
  | SourceUnavailable
