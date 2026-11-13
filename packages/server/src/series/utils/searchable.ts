import type { Outline } from "../Outline.schemas.ts"

// A chart shows annual values of some of our countries, so a dataset with no
// annual values, or none of our countries, is left out of the catalog's
// search.
export const searchable = (outline: Pick<Outline, "annual" | "countries">) =>
  outline.annual !== false && (outline.countries === null || outline.countries.length > 0)
