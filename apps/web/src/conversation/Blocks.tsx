import { type Block, Chart } from "@civicdata/domain"
import { Schema } from "effect"
import { Fragment, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Prose } from "@/explore/Prose"

const isChart = Schema.is(Chart)

interface BlocksProps {
  blocks: ReadonlyArray<Block>
  // Each chart of the answer, in order, as the caller draws it.
  charts: ReadonlyArray<ReactNode>
  // While the agent answers, what it did before each block, then what it has
  // done since the last.
  work?: ReadonlyArray<ReactNode>
  // Whether a person changed a chart since the agent wrote: its words then
  // describe charts no longer on screen.
  changed?: boolean
}

// The blocks of an answer in the order the agent wrote them: its words, and
// each chart named by its place among the answer's charts. While the agent
// answers, its work sits between them, in the order it happened. Each block
// keeps its place when the work around it goes, so a chart drawn while the
// agent answers stays as it is once the answer is kept. Once a person changes
// a chart, the words grey out and say so.
export const Blocks = ({ blocks, charts, work, changed = false }: BlocksProps) => {
  const { t } = useTranslation("conversation")

  const after = work?.[blocks.length] ?? null

  if (blocks.length === 0 && after === null) return null

  // The countries the answer's charts show, which name who a cited event
  // concerns.
  const countries = [
    ...new Set(blocks.flatMap((block) => (isChart(block) ? block.view.countries : []))),
  ]

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => {
        const place = blocks.slice(0, index).filter(isChart).length

        return (
          // oxlint-disable-next-line react/no-array-index-key -- a block keeps its place in its answer
          <Fragment key={index}>
            {work?.[index]}
            {isChart(block) ? (
              <section
                aria-label={t(($) => $["Chart {{value1}} of the answer"], { value1: place + 1 })}
              >
                {charts[place]}
              </section>
            ) : (
              <Prose
                text={block.text}
                cites={block.cites}
                countries={countries}
                className={changed ? "text-muted-foreground" : undefined}
              />
            )}
          </Fragment>
        )
      })}
      {after}
      {changed && blocks.some((block) => !isChart(block)) ? (
        <p className="text-sm text-muted-foreground">
          {t(($) => $["This answer describes the charts before your changes."])}
        </p>
      ) : null}
    </div>
  )
}
