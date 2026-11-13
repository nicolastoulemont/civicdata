import type { Codelist } from "../../series/Outline.schemas.ts"

// The label of each code of some codelists.
export type Labels = ReadonlyMap<Codelist, ReadonlyMap<string, string>>
