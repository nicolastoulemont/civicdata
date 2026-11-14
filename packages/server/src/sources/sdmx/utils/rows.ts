import { fields } from "./fields.ts"

// SDMX-CSV 2.0, as Eurostat and the OECD answer data queries. Parsed by hand:
// a schema per row costs more CPU than a Worker on the free plan gets.

export const rows = (text: string) => {
  const [header = "", ...lines] = text.split(/\r?\n/)

  return { header, lines: lines.filter((line) => line !== "").map(fields) }
}
