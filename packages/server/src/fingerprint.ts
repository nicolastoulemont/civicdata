import { Effect } from "effect"

// The SHA-256 of the text, in hex. A build stores one beside each generation
// it writes and skips a source or dataset whose fingerprint matches the
// published generation's; a gathering run stores one beside each series.
export const fingerprint = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  )
