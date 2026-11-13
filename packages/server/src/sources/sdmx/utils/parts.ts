import type { IndicatorId } from "@repo/domain"

// "agency,id,version", as IndicatorId checks it.
export const parts = (indicator: IndicatorId) => {
  const [agency = "", id = "", version = ""] = indicator.split(",")

  return { agency, id, version }
}
