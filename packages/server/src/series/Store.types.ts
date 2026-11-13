import type { Country, Year } from "@repo/domain"
import { Data } from "effect"

import type { Stored } from "./Store.schemas.ts"

// What the store needs from an R2 bucket binding.
export interface SeriesBucket {
  readonly get: (key: string) => Promise<{
    readonly text: () => Promise<string>
    readonly customMetadata?: Record<string, string> | undefined
  } | null>
  readonly put: (
    key: string,
    value: string,
    options: {
      readonly customMetadata: Record<string, string>
      readonly onlyIf?: { readonly etagDoesNotMatch: string }
    },
  ) => Promise<{ readonly key: string } | null>
  readonly delete: (keys: Array<string>) => Promise<void>
}

// A country and year a series has a value for.
export interface Place {
  readonly country: Country
  readonly year: Year
}

// What to do with a candidate for a stored series. A candidate that is empty
// or loses country-years the stored series has is held back: the stored
// series keeps serving. Revised values and added country-years replace it,
// since sources revise legitimately, sometimes by a lot.
export type Verdict = Data.TaggedEnum<{
  Replace: {}
  Hold: { readonly reason: "Empty" | "Lost"; readonly lost: ReadonlyArray<Place> }
}>

export const Verdict = Data.taggedEnum<Verdict>()

// What a write did with one candidate: stored it, kept the stored series
// because it holds the same values, or held it back.
export type Outcome = Data.TaggedEnum<{
  Stored: {}
  Unchanged: {}
  Held: { readonly reason: "Empty" | "Lost"; readonly lost: ReadonlyArray<Place> }
}>

export const Outcome = Data.taggedEnum<Outcome>()

// A candidate, its observations sorted by country and year, and what the
// write did with it.
export interface Offer {
  readonly candidate: Stored
  readonly outcome: Outcome
}
