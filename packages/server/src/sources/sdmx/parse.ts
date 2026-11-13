import { Code, type Country, DimensionId, IndicatorId, sourceOf } from "@repo/domain"
import { Array as Arr, Option, Schema, Stream } from "effect"

import type { Codelist, Outline } from "../../series/Outline.ts"
import { areas } from "./Csv.ts"

// The outlines and codelists Eurostat and the OECD publish, parsed. Shared
// by the catalog Workflow (CatalogBuild.ts) and the script that fills a
// stage's catalog the first time (scripts/outlines.ts).

const isCode = Schema.is(Code)
const isDimension = Schema.is(DimensionId)
const toIndicator = Schema.decodeUnknownOption(IndicatorId)

const years = (found: ReadonlyArray<number>) =>
  found.length === 0 ? null : { first: Math.min(...found), last: Math.max(...found) }

// A dimension's codes as an outline stores them: the ones a code can be, each
// once, or none when no code is.
const dimension = (id: string, codelist: Codelist | null, codes: Iterable<string>) => {
  const kept = [...new Set(codes)].filter(isCode)

  return isDimension(id) && Arr.isArrayNonEmpty(kept)
    ? Option.some({ id, codelist, codes: kept })
    : Option.none()
}

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

const KeyValue = Schema.Struct({
  id: Schema.String,
  values: Schema.optionalKey(Schema.Array(Schema.String)),
  timeRange: Schema.optionalKey(
    Schema.Struct({
      startPeriod: Schema.optionalKey(Schema.Struct({ period: Schema.String })),
      endPeriod: Schema.optionalKey(Schema.Struct({ period: Schema.String })),
    }),
  ),
})

// The OECD's content constraints: for each dataflow, the codes its data
// takes ("Actual") and the codes its structure allows ("Allowed").
export const Constraints = Schema.Struct({
  data: Schema.Struct({
    contentConstraints: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        constraintAttachment: Schema.Struct({
          dataflows: Schema.optionalKey(Schema.Array(Schema.String)),
        }),
        cubeRegions: Schema.optionalKey(
          Schema.Array(Schema.Struct({ keyValues: Schema.optionalKey(Schema.Array(KeyValue)) })),
        ),
      }),
    ),
  }),
})

// The OECD's data structures: each one's dimensions and the codelist of
// each.
export const DataStructures = Schema.Struct({
  data: Schema.Struct({
    dataStructures: Schema.Array(
      Schema.Struct({
        agencyID: Schema.String,
        id: Schema.String,
        dataStructureComponents: Schema.Struct({
          dimensionList: Schema.Struct({
            dimensions: Schema.Array(
              Schema.Struct({
                id: Schema.String,
                localRepresentation: Schema.optionalKey(
                  Schema.Struct({ enumeration: Schema.optionalKey(Schema.String) }),
                ),
              }),
            ),
          }),
        }),
      }),
    ),
  }),
})

// "urn:...=OECD.SDD.TPS:DSD_LFS@DF_IALFS_UNE_M(1.0)" → its agency, id and
// version.
const urn = (text: string) => {
  const found = /=([^:=]+):([^:(]+)\(([^)]+)\)$/.exec(text)

  return found === null
    ? undefined
    : { agency: found[1] ?? "", id: found[2] ?? "", version: found[3] ?? "" }
}

const year = (period: string | undefined) => {
  const found = period === undefined ? Number.NaN : Number(period.slice(0, 4))

  return Number.isInteger(found) ? [found] : []
}

const oecdCountries = areas.OECD.country

// Combine the codes and time bounds from a constraint's cube regions.
const regionValues = (
  regions: ReadonlyArray<{ readonly keyValues?: ReadonlyArray<typeof KeyValue.Type> }>,
) => {
  const values = new Map<string, Array<string>>()
  const found: Array<number> = []

  for (const { id, values: codes = [], timeRange } of regions.flatMap(
    (region) => region.keyValues ?? [],
  )) {
    if (id === "TIME_PERIOD") {
      found.push(...year(timeRange?.startPeriod?.period), ...year(timeRange?.endPeriod?.period))
    } else values.set(id, [...(values.get(id) ?? []), ...codes])
  }

  return { values, found }
}

const oecdIndicator = (flow: ReturnType<typeof urn>) => {
  if (flow === undefined) return Option.none()

  return toIndicator(`${flow.agency},${flow.id},${flow.version}`).pipe(
    Option.filter((indicator) => sourceOf(indicator) === "OECD"),
  )
}

const coveredCountries = (codes: ReadonlyArray<string> = []) =>
  [...new Set(codes.flatMap((code) => oecdCountries.get(code) ?? []))].toSorted()

const seriesDimensions = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  listed: ReadonlyMap<string, Codelist>,
) =>
  [...values].flatMap(([id, codes]) =>
    id === "REF_AREA" || id === "FREQ"
      ? []
      : Option.toArray(dimension(id, listed.get(id) ?? null, codes)),
  )

// Some dataflows have several Actual constraints. Combine their regions
// before decoding the outline, so a dataflow has one stable fingerprint.
const actualConstraints = (
  constraints: (typeof Constraints.Type)["data"]["contentConstraints"],
) => {
  const flows = new Map<string, (typeof constraints)[number]>()

  for (const constraint of constraints) {
    if (constraint.type !== "Actual") continue

    const flow = constraint.constraintAttachment.dataflows?.[0] ?? ""
    const previous = flows.get(flow)

    flows.set(flow, {
      ...constraint,
      cubeRegions: [...(previous?.cubeRegions ?? []), ...(constraint.cubeRegions ?? [])],
    })
  }

  return [...flows.values()]
}

// The outline of each OECD dataflow with a constraint on the codes its data
// takes, from the constraints and the structures, both decoded from JSON.
// A dataflow's structure is the one its id names before "@", of its own
// agency if two agencies define one. Its frequency dimension lists "A" when
// it has annual values; a dataflow without one is taken as annual, as the
// data requests that leave frequency out (Sdmx.ts). A dataflow without a
// constraint, or one whose structure the file lacks, keeps no outline or no
// codelists.
export const constraints = ({
  constraints: { data },
  structures: {
    data: { dataStructures: structures },
  },
}: {
  readonly constraints: typeof Constraints.Type
  readonly structures: typeof DataStructures.Type
}): ReadonlyArray<Outline> => {
  const codelists = (agency: string, dataflow: string) => {
    const id = dataflow.split("@")[0]

    const named = structures.filter((structure) => structure.id === id)

    const structure =
      named.find((each) => each.agencyID === agency) ?? (named.length === 1 ? named[0] : undefined)

    return new Map(
      (structure?.dataStructureComponents.dimensionList.dimensions ?? []).flatMap((each) => {
        const enumeration = urn(each.localRepresentation?.enumeration ?? "")

        return enumeration === undefined
          ? []
          : [[each.id, `${enumeration.agency}:${enumeration.id}`] as const]
      }),
    )
  }

  return actualConstraints(data.contentConstraints).flatMap(
    (constraint): ReadonlyArray<Outline> => {
      const flow = urn(constraint.constraintAttachment.dataflows?.[0] ?? "")
      const regions = constraint.cubeRegions ?? []

      if (flow === undefined || regions.length === 0) return []

      const indicator = oecdIndicator(flow)

      if (Option.isNone(indicator)) return []

      const listed = codelists(flow.agency, flow.id)
      const { values, found } = regionValues(regions)

      const frequencies = values.get("FREQ")

      return [
        {
          indicator: indicator.value,
          dimensions: seriesDimensions(values, listed),
          annual: frequencies === undefined || frequencies.includes("A"),
          countries: coveredCountries(values.get("REF_AREA")),
          years: years(found),
        },
      ]
    },
  )
}

// The label of each code of some codelists.
export type Labels = ReadonlyMap<Codelist, ReadonlyMap<string, string>>

// One Eurostat codelist as JSON-stat, alone or in a collection.
const EurostatCodelist = Schema.Struct({
  category: Schema.Struct({ label: Schema.Record(Schema.String, Schema.String) }),
  extension: Schema.Struct({ id: Schema.String }),
})

export const EurostatCodelists = Schema.Union([
  Schema.Struct({ link: Schema.Struct({ item: Schema.Array(EurostatCodelist) }) }),
  EurostatCodelist,
])

// Eurostat's codelists: every one at once (58 MB), or one.
export const eurostatLabels = (decoded: typeof EurostatCodelists.Type): Labels =>
  new Map(
    ("link" in decoded ? decoded.link.item : [decoded]).map(({ category, extension }) => [
      `ESTAT:${extension.id}`,
      new Map(Object.entries(category.label)),
    ]),
  )

export const OecdCodelists = Schema.Struct({
  data: Schema.Struct({
    codelists: Schema.Array(
      Schema.Struct({
        agencyID: Schema.String,
        id: Schema.String,
        codes: Schema.optionalKey(
          Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
        ),
      }),
    ),
  }),
})

// The OECD's codelists: every one at once (33 MB), or one.
export const oecdLabels = ({ data }: typeof OecdCodelists.Type): Labels => {
  const labels = new Map<Codelist, Map<string, string>>()

  for (const { agencyID, id, codes = [] } of data.codelists) {
    const key = `${agencyID}:${id}`
    const known = labels.get(key) ?? new Map<string, string>()

    for (const code of codes) known.set(code.id, code.name)

    labels.set(key, known)
  }

  return labels
}
