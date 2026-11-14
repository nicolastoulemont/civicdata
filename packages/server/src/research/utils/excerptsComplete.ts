import type { Classification, Scope } from "../annotation.schemas.ts"

export const excerptsComplete = (classified: typeof Classification.Type, scope: Scope) =>
  classified.excerpts.length === scope.excerpts.length &&
  classified.excerpts.every((result, index) => {
    const anchor = scope.excerpts[index]

    return anchor !== undefined && anchor.page === result.page && anchor.quote === result.quote
  })
