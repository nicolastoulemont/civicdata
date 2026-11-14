import { SourceUnavailable } from "@repo/domain"

import { Internal, type Reason } from "../GatherLedger.schemas.ts"
import { failureOf } from "./failureOf.ts"

export const reasonOf = (error: { readonly _tag: string }): Reason =>
  error instanceof SourceUnavailable ? failureOf(error) : Internal.make({})
