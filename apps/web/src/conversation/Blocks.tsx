import { type Block, Chart } from "@civicdata/domain"
import { Schema } from "effect"
import type { ReactNode } from "react"

import { Prose } from "@/explore/Prose"

const isChart = Schema.is(Chart)

interface BlocksProps {
  blocks: ReadonlyArray<Block>
  // Each chart of the answer, in order, as the caller draws it.
  charts: ReadonlyArray<ReactNode>
  // Whether a person changed a chart since the agent wrote: its words then
  // describe charts no longer on screen.
  changed?: boolean
}

// The blocks of an answer in the order the agent wrote them: its words, and
// each chart named by its place among the answer's charts. Once a person
// changes a chart, the words grey out and say so.
export const Blocks = ({ blocks, charts, changed = false }: BlocksProps) => {
  // The countries the answer's charts show, which name who a cited event
  // concerns.
  const countries = [
    ...new Set(blocks.flatMap((block) => (isChart(block) ? block.view.countries : []))),
  ]

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => {
        if (!isChart(block)) {
          return (
            <Prose
              // oxlint-disable-next-line react/no-array-index-key -- a block keeps its place in its answer
              key={index}
              text={block.text}
              cites={block.cites}
              countries={countries}
              className={changed ? "text-muted-foreground" : undefined}
            />
          )
        }

        const place = blocks.slice(0, index).filter(isChart).length

        return (
          // oxlint-disable-next-line react/no-array-index-key -- a block keeps its place in its answer
          <section key={index} aria-label={`Chart ${place + 1} of the answer`}>
            {charts[place]}
          </section>
        )
      })}
      {changed && blocks.some((block) => !isChart(block)) ? (
        <p className="text-sm text-muted-foreground">
          This answer describes the charts before your changes.
        </p>
      ) : null}
    </div>
  )
}
