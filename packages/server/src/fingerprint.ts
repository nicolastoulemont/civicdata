import { Effect, Schema } from "effect"

// The SHA-256 of UTF-8 text or raw bytes, in hex. A build stores one beside each generation
// it writes and skips a source or dataset whose fingerprint matches the
// published generation's; a gathering run stores one beside each series.
export const fingerprint = (value: string | Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      Schema.is(Schema.String)(value) ? new TextEncoder().encode(value) : new Uint8Array(value),
    ),
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  )
