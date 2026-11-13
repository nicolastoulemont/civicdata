import type { Country, SeriesKey, Year } from "@repo/domain"

// What the Resolver asks a source adapter for: one series' values for some
// countries and years.
export interface Query extends SeriesKey {
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}
