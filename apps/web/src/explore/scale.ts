// Round tick values covering low to high, about four steps apart.
export const ticks = (low: number, high: number) => {
  const rough = (high - low) / 4
  const power = 10 ** Math.floor(Math.log10(rough))

  const step =
    [1, 2, 5, 10].map((multiple) => multiple * power).find((size) => size >= rough) ?? rough

  const first = Math.floor(low / step) * step
  const count = Math.round((Math.ceil(high / step) * step - first) / step)

  return Array.from({ length: count + 1 }, (_, index) => first + index * step)
}

// Round ticks around the values and the range they span, for a chart that
// marks values with dots rather than bars from zero. Never empty, so
// all-equal values still draw, and no values give 0 to 1.
export const around = (values: ReadonlyArray<number>) => {
  const low = values.length === 0 ? 0 : Math.min(...values)
  const high = values.length === 0 ? 1 : Math.max(...values)
  const marks = high === low ? ticks(low - 1, high + 1) : ticks(low, high)

  return { ticks: marks, low: marks[0] ?? low, high: marks.at(-1) ?? high + 1 }
}

// Round ticks from zero to the values, for bars that grow from zero, e.g.
// across every year of a ranking over time. No values, or only zeros, give
// 0 to 1.
export const fromZero = (values: ReadonlyArray<number>) => {
  const marks = ticks(Math.min(0, ...values), Math.max(0, ...values))

  return [marks[0] ?? 0, marks.at(-1) ?? 1] as const
}
