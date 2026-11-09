// The chart colours a trend's lines take, strongest first: one country gets the
// clearest line in either theme, and the first three stay far apart in
// lightness. The legend names every line.
const order = [5, 3, 2, 4, 1]

export const lineColor = (index: number) => `var(--chart-${order[index % order.length]})`
