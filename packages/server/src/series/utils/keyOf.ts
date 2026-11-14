import type { SeriesKey } from "@repo/domain"

import type { Stored } from "../Store.schemas.ts"

// The series' key: its indicator and dimensions.
export const keyOf = (series: Stored): SeriesKey => ({
  indicator: series.indicator.id,
  dimensions: series.dimensions,
})
