import { Scope } from "../annotation.schemas.ts"

export const evidenceOf = (design: Scope["design"]) =>
  Scope.fields.design.match(design, {
    Unknown: () => [],
    Description: ({ evidence }) => [evidence],
    Association: ({ evidence }) => [evidence],
    AuthorCausalEstimate: ({ evidence }) => [evidence],
  })
