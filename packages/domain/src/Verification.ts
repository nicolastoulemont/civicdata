import { Schema } from "effect"

export const verificationHeader = "x-turnstile-token"
export const verificationAction = "assistant"

export const VerificationToken = Schema.NonEmptyString.check(Schema.isMaxLength(2048)).pipe(
  Schema.brand("VerificationToken"),
)

export type VerificationToken = typeof VerificationToken.Type

export class VerificationRequired extends Schema.TaggedError<VerificationRequired>()(
  "VerificationRequired",
  {},
  { httpApiStatus: 403 },
) {}

export class VerificationUnavailable extends Schema.TaggedError<VerificationUnavailable>()(
  "VerificationUnavailable",
  {},
  { httpApiStatus: 503 },
) {}
