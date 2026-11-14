import { sourceOf } from "@repo/domain"
import { Option } from "effect"

import type { Codelist, Outline } from "../../../series/Outline.schemas.ts"
import { areas } from "../constants/areas.ts"
import {
  type Constraints,
  type DataStructures,
  type KeyValue,
  toIndicator,
} from "../parse.schemas.ts"
import { dimension } from "./dimension.ts"
import { years } from "./years.ts"

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
