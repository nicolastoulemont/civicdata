import { countries } from "@repo/domain"

import { Question } from "../search.schemas.ts"

// Explicit filters are preferable for aliases and complex periods. CLI inference
// recognises canonical country names and literal four-digit years only.
export const questionOf = (text: string): Question => {
  const years = [...text.matchAll(/\b(?:18|19|20)\d{2}\b/g)].map(([year]) => Number(year))
  const lower = ` ${text.toLowerCase().replace(/[^a-z]/g, " ")} `

  return Question.make({
    text,
    countries: countries.flatMap(({ code, name }) =>
      lower.includes(` ${name.toLowerCase().replace(/[^a-z]/g, " ")} `) ? [code] : [],
    ),
    period: years.length === 0 ? null : { from: Math.min(...years), to: Math.max(...years) },
    intent: /\b(?:why|caus\w*|effects?|impacts?|caused)\b/i.test(text) ? "Cause" : "Evidence",
  })
}
