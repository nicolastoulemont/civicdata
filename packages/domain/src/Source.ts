import { Schema } from "effect"

import type { IndicatorId } from "./Indicator.ts"

// Who publishes the data. Each requires its name next to every chart.
export const Source = Schema.Literals(["World Bank", "Eurostat", "OECD"])

export type Source = typeof Source.Type

// An SDMX dataflow's agency names its source: ESTAT is Eurostat, and OECD
// directorates are "OECD" or start with "OECD.". A code without an agency is
// the World Bank's.
export const sourceOf = (indicator: IndicatorId): Source => {
  const [agency, flow] = indicator.split(",")

  if (flow === undefined) return "World Bank"

  return agency === "ESTAT" ? "Eurostat" : "OECD"
}
