import type { ReactNode } from "react"

interface ChartsProps {
  charts: ReadonlyArray<ReactNode>
}

// The charts of an answer in the order the agent drew them, each named by its
// place in the answer.
export const Charts = ({ charts }: ChartsProps) => (
  <div className="flex flex-col gap-4">
    {charts.map((chart, place) => (
      // oxlint-disable-next-line react/no-array-index-key -- a chart keeps its place in its answer
      <section key={place} aria-label={`Chart ${place + 1} of the answer`}>
        {chart}
      </section>
    ))}
  </div>
)
