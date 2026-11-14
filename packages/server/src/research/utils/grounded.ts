import type { Scope } from "../annotation.schemas.ts"
import type { Passage } from "../archive.schemas.ts"
import { evidenceOf } from "./evidenceOf.ts"

const normalize = (text: string) => text.replace(/\s+/g, " ").trim()

// A quote proves the model read an existing page, not that its interpretation is true.
export const grounded = (scope: Scope, passages: ReadonlyArray<typeof Passage.Type>) => {
  const anchors = [
    ...scope.excerpts,
    ...(scope.population === null ? [] : [scope.population]),
    ...scope.countries.map(({ evidence }) => evidence),
    ...scope.regions.map(({ evidence }) => evidence),
    ...scope.periods.map(({ evidence }) => evidence),
    ...evidenceOf(scope.design),
  ]

  return (
    anchors.every(
      ({ page, quote }) =>
        normalize(quote).length > 0 &&
        normalize(
          passages.flatMap((passage) => (passage.page === page ? [passage.text] : [])).join(" "),
        ).includes(normalize(quote)),
    ) &&
    scope.periods.every(
      ({ from, to, evidence }) =>
        from <= to && evidence.quote.includes(String(from)) && evidence.quote.includes(String(to)),
    )
  )
}
