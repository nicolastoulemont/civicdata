import type { Country, Flag } from "@repo/domain"

// Where each source names the country in its data, and how, and where it
// flags a value. OECD codes are ISO 3166-1 alpha-3, like ours; Eurostat's
// are two letters. Each letter of a flag cell is one flag: Eurostat writes
// "ep" for estimated and provisional.
export interface Area {
  readonly column: string
  readonly country: ReadonlyMap<string, Country>
  readonly flag: string
  readonly flags: ReadonlyMap<string, Flag>
}
