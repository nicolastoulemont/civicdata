import { type Country } from "@repo/domain"
import { Option, Stream } from "effect"

import type { Outline } from "../../series/Outline.schemas.ts"
import { areas } from "./constants/areas.ts"
import { toIndicator } from "./parse.schemas.ts"
import { dimension } from "./utils/dimension.ts"
import { years } from "./utils/years.ts"

// The outlines and codelists Eurostat and the OECD publish, parsed. Shared
// by the catalog Workflow (CatalogBuild.ts) and the script that fills a
// stage's catalog the first time (scripts/outlines.ts).

// The dataset whose lines the metabase is reading.
interface Draft {
  readonly dataset: string
  readonly dimensions: Map<string, Array<string>>
  readonly countries: Set<Country>
  readonly years: Array<number>
  annual: boolean
}

const eurostatCountry = areas.Eurostat.country

const finish = (draft: Draft | undefined): ReadonlyArray<Outline> => {
  if (draft === undefined) return []

  const indicator = toIndicator(`ESTAT,${draft.dataset.toUpperCase()},1.0`)

  if (Option.isNone(indicator)) return []

  return [
    {
      indicator: indicator.value,
      dimensions: [...draft.dimensions].flatMap(([id, codes]) =>
        Option.toArray(dimension(id, `ESTAT:${id.toUpperCase()}`, codes)),
      ),
      annual: draft.annual,
      countries: [...draft.countries].toSorted(),
      years: years(draft.years),
    },
  ]
}

// Add a metabase code to its country's, period's or series' dimension.
const addCode = (draft: Draft, { id, code }: { id: string; code: string }) => {
  if (id === "geo") {
    const country = eurostatCountry.get(code)

    if (country !== undefined) draft.countries.add(country)
  } else if (id === "time") {
    if (/^\d{4}$/.test(code)) {
      draft.annual = true
      draft.years.push(Number(code))
    }
  } else if (id !== "freq") {
    const codes = draft.dimensions.get(id)

    if (codes === undefined) draft.dimensions.set(id, [code])
    else codes.push(code)
  }
}

// One line of the metabase, "dataset<TAB>dimension<TAB>code", read into the
// dataset it belongs to. The file lists each dataset's lines together, so a
// new dataset finishes the one before. It names no frequency: a period of
// four digits ("2024") is a year, any other ("2024-Q1", "2024-01") is not.
// Every dimension's codelist has the dimension's id, in capitals.
const readLine = (
  draft: Draft | undefined,
  line: string,
): readonly [Draft | undefined, ReadonlyArray<Outline>] => {
  const [dataset = "", id = "", code = ""] = line.split("\t")

  if (dataset === "" || id === "" || code === "") return [draft, []]

  const current: Draft =
    draft?.dataset === dataset
      ? draft
      : { dataset, dimensions: new Map(), countries: new Set(), years: [], annual: false }

  addCode(current, { id, code })

  return [current, current === draft ? [] : finish(draft)]
}

// Eurostat's metabase, `catalogue/metabase.txt.gz` once unzipped: every
// dimension and code in use of every dataset, one per line. Read as it
// streams, a dataset at a time, so a Worker never holds the 34 MB file.
const start = (): Draft | undefined => undefined

export const metabase = <E, R>(lines: Stream.Stream<string, E, R>) =>
  lines.pipe(Stream.mapAccum(start, readLine, { onHalt: finish }))
