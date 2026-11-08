import { Schema } from "effect"

// What a chart shows instead of the indicator's own values:
// - PerPerson: divided by the country's population that year.
// - Growth: percent change from the previous year.
// - Index: relative to the first year shown, which is 100.
export const Transform = Schema.Literals(["PerPerson", "Growth", "Index"])

export type Transform = typeof Transform.Type

// What an indicator's values are, read from its World Bank name:
// - Amount: a total, such as "Population, total" or "GDP (current US$)".
// - PerUnit: a value per person, per birth or in years, such as
//   "GDP per capita (current US$)" or "Life expectancy at birth, total (years)".
// - Percentage: a share or a rate, such as "Unemployment (% of labor force)".
type Measure = "Amount" | "PerUnit" | "Percentage"

const measureOf = (name: string): Measure => {
  if (name.includes("%")) return "Percentage"

  return /\bper\b|\(years\)|\bindex\b|\bratio\b|\brate\b/i.test(name) ? "PerUnit" : "Amount"
}

// Only totals divide by population. Growth and an index of a percentage would
// read as a relative change of a rate, so percentages take no transform.
const applicable: Record<Transform, ReadonlyArray<Measure>> = {
  PerPerson: ["Amount"],
  Growth: ["Amount", "PerUnit"],
  Index: ["Amount", "PerUnit"],
}

// Whether `transform` makes sense for the indicator with this name.
export const applies = (transform: Transform, name: string) =>
  applicable[transform].includes(measureOf(name))
