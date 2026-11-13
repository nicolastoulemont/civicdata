import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync, gzipSync } from "node:zlib"

import { Country } from "@repo/domain"
import { Schema } from "effect"
import { strFromU8, unzipSync, zipSync } from "fflate"
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson"
import shp from "shpjs"
import { merge } from "topojson-client"
import { topology } from "topojson-server"

import { readCuracao } from "./curacao.ts"
import { cut, cutBoundaries, clipBoundaries } from "./cuts.ts"
import { geometry } from "./lands.ts"
import { readOverture, selection as overtureSelection } from "./overture.ts"
import { readWorldBank, worldBankSelection } from "./worldbank.ts"

const strings = Schema.Record(Schema.String, Schema.NonEmptyString)

const selector = Schema.Union([overtureSelection, worldBankSelection])

const fields = {
  url: Schema.NonEmptyString,
  code: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  hash: Schema.NonEmptyString,
}

const input = Schema.Union([
  Schema.Struct({
    ...fields,
    format: Schema.Literals(["GeoJSON", "ZipJSON", "Shapefile", "Norway", "Curacao"]),
    member: Schema.optionalKey(Schema.String),
    path: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ...fields,
    format: Schema.Literal("Overture"),
    selection: overtureSelection,
  }),
  Schema.Struct({ ...fields, format: Schema.Literal("WorldBank"), selection: worldBankSelection }),
])

const credit = Schema.Struct({
  publisher: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  vintage: Schema.NonEmptyString,
  license: Schema.NonEmptyString,
  licenseUrl: Schema.NonEmptyString,
  kind: Schema.Literals(["Administrative", "Statistical", "Geographic"]),
})

const manifest = Schema.Array(
  Schema.Struct({
    country: Country,
    id: Schema.NonEmptyString,
    credit,
    inputs: Schema.Array(input),
    cuts: Schema.optionalKey(Schema.Array(cut)),
    coast: Schema.optionalKey(Schema.NonEmptyString),
    names: Schema.optionalKey(strings),
    joins: Schema.optionalKey(strings),
    omit: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    islands: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          from: Schema.NonEmptyString,
          code: Schema.NonEmptyString,
          name: Schema.NonEmptyString,
          box: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
        }),
      ),
    ),
  }),
)

const properties = Schema.Record(Schema.String, Schema.Unknown)

const polygonFeature = Schema.Struct({
  type: Schema.Literal("Feature"),
  properties,
  geometry,
})

const collection = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.Array(polygonFeature),
})

const scalar = Schema.Union([Schema.NonEmptyString, Schema.Finite])

const feature = Schema.Struct({
  type: Schema.Literal("Feature"),
  geometry,
  properties: Schema.Struct({
    code: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    native: properties,
  }),
})

const snapshot = Schema.Struct({
  country: Country,
  credit,
  inputs: Schema.Array(
    Schema.Struct({
      url: Schema.NonEmptyString,
      sha256: Schema.NonEmptyString,
      selection: Schema.optionalKey(selector),
      hash: Schema.NonEmptyString,
      retrieved: Schema.NonEmptyString,
      features: Schema.Array(feature),
    }),
  ),
})

const file = new URL("./boundaries.json", import.meta.url)
const sources = () => Schema.decodeUnknownSync(manifest)(JSON.parse(readFileSync(file, "utf8")))
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

// Finer source units become a partition of the displayed divisions. Dissolve
// their interior borders before pinning, retaining every member's attributes.
const divisions = (features: ReadonlyArray<typeof feature.Type>) => {
  const codes = [...new Set(features.map((part) => part.properties.code))]

  if (codes.length === features.length) return features

  const data: FeatureCollection<Polygon | MultiPolygon, (typeof feature.Type)["properties"]> = {
    type: "FeatureCollection",
    features: [...features],
  }

  const source = topology({ divisions: data })
  const areas = source.objects["divisions"]

  if (areas?.type !== "GeometryCollection") throw new Error("Expected boundary polygons")

  return codes.map((code) => {
    const members = features.filter((part) => part.properties.code === code)
    const first = members[0]

    if (first === undefined) throw new Error(`Missing boundary ${code}`)

    if (members.length === 1) return first

    return Schema.decodeUnknownSync(feature)({
      type: "Feature",
      geometry: merge(
        source,
        areas.geometries
          .filter((area) => area.type === "Polygon" || area.type === "MultiPolygon")
          .filter((area) => area.properties?.["code"] === code)
          .map((area) =>
            area.type === "Polygon"
              ? { type: area.type, arcs: area.arcs }
              : { type: area.type, arcs: area.arcs },
          ),
      ),
      properties: {
        code,
        name: first.properties.name,
        native: { members: members.map((part) => part.properties.native) },
      },
    })
  })
}

// Island municipalities can separate from a mainland parent without cutting
// any polygon. Reject a box that crosses land rather than guessing a border.
const separate = (
  features: ReadonlyArray<typeof feature.Type>,
  islands: NonNullable<(typeof manifest.Type)[number]["islands"]>,
) => {
  let selected = features

  for (const island of islands) {
    selected = selected.flatMap((part) => {
      if (part.properties.code !== island.from) return [part]

      const polygons =
        part.geometry.type === "Polygon" ? [part.geometry.coordinates] : part.geometry.coordinates

      const [west, south, east, north] = island.box

      const contains = ([x, y]: readonly [number, number]) =>
        x >= west && x <= east && y >= south && y <= north

      for (const polygon of polygons) {
        const points = polygon.flat()

        if (points.some(contains) && !points.every(contains))
          throw new Error(`Island box crosses land: ${island.code}`)
      }

      return [false, true].flatMap((inside) => {
        const coordinates = polygons.filter((polygon) => polygon.flat().every(contains) === inside)

        if (coordinates.length === 0) return []

        return [
          Schema.decodeUnknownSync(feature)({
            type: "Feature",
            geometry: { type: "MultiPolygon", coordinates },
            properties: {
              code: inside ? island.code : part.properties.code,
              name: inside ? island.name : part.properties.name,
              native: part.properties.native,
            },
          }),
        ]
      })
    })
  }

  return selected
}

const decode = async (bytes: Uint8Array, source: typeof input.Type) => {
  const member = "member" in source ? source.member : undefined

  if (source.format === "Curacao")
    return Schema.decodeUnknownSync(collection)(readCuracao(strFromU8(bytes)))

  if (source.format === "Shapefile") {
    if (member === undefined) throw new Error("Shapefile source requires a member prefix")
    const entries = unzipSync(bytes, { filter: (entry) => entry.name.startsWith(member) })

    if (!Object.keys(entries).some((name) => name.endsWith(".shp")))
      throw new Error(`Missing shapefile ${member}`)
    const value = await shp(Buffer.from(zipSync(entries)))

    return Schema.decodeUnknownSync(collection)(value)
  }

  const raw =
    source.format === "ZipJSON" && member !== undefined
      ? unzipSync(bytes, { filter: (entry) => entry.name === member })[member]
      : bytes

  if (raw === undefined) throw new Error(`Missing archive member ${member}`)
  const value = Schema.decodeUnknownSync(properties)(JSON.parse(strFromU8(raw)))

  if (source.format === "Norway") {
    const county = Schema.decodeUnknownSync(
      Schema.Struct({ fylkesnummer: Schema.String, fylkesnavn: Schema.String, omrade: geometry }),
    )(value)

    return Schema.decodeSync(collection)({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: county.omrade,
          properties: { code: county.fylkesnummer, name: county.fylkesnavn },
        },
      ],
    })
  }

  return Schema.decodeUnknownSync(collection)(
    "path" in source && source.path !== undefined ? value[source.path] : value,
  )
}

// Pins decoded, selected features, so a WFS request timestamp cannot change a release.
// Full response byte hashes and original properties are retained for each input.
export const refreshBoundaries = async () => {
  const pinned = []
  const boundaries = sources()

  const extracts = await readOverture(
    boundaries
      .filter(
        (boundary) =>
          !process.argv.includes("--pin-boundaries") ||
          boundary.inputs.some((source) => source.hash === "pending"),
      )
      .flatMap((boundary) => boundary.inputs.filter((source) => source.format === "Overture"))
      .map(({ url, selection }) => ({ url, selection })),
  )

  // Sequential countries bound memory when an archive contains several administrative levels.
  // eslint-disable-next-line no-await-in-loop
  for (const boundary of boundaries) {
    if (
      process.argv.includes("--pin-boundaries") &&
      boundary.inputs.every((source) => source.hash !== "pending")
    ) {
      pinned.push(boundary)
      continue
    }

    const inputs = []
    const snapshots = []

    // eslint-disable-next-line no-await-in-loop
    for (const source of boundary.inputs) {
      let bytes =
        source.format === "Overture"
          ? extracts.get(JSON.stringify({ url: source.url, selection: source.selection }))
          : undefined

      if (source.format === "Overture" && bytes === undefined)
        throw new Error(`Missing Overture extract for ${boundary.id}`)

      if (source.format === "WorldBank") {
        if (source.selection.country !== boundary.country)
          throw new Error(`Wrong World Bank country for ${boundary.id}`)
        // eslint-disable-next-line no-await-in-loop
        bytes = await readWorldBank(source.url, source.selection)
      }

      if (bytes === undefined) {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(source.url)

        if (!response.ok) throw new Error(`${boundary.id}: HTTP ${response.status}`)
        // eslint-disable-next-line no-await-in-loop
        bytes = new Uint8Array(await response.arrayBuffer())
      }

      // eslint-disable-next-line no-await-in-loop
      const data = await decode(bytes, source)

      const features = divisions(
        separate(
          data.features.flatMap((part) => {
            const native = part.properties
            const original = `${Schema.decodeUnknownSync(scalar)(native[source.code])}`

            if (boundary.omit?.includes(original)) return []
            const code = boundary.joins?.[original] ?? original

            const name =
              boundary.names?.[code] ??
              Schema.decodeUnknownSync(Schema.NonEmptyString)(native[source.name])

            return [
              { type: part.type, geometry: part.geometry, properties: { code, name, native } },
            ]
          }),
          boundary.islands ?? [],
        ),
      )

      const hash = digest(JSON.stringify(features))

      if (!process.argv.includes("--pin-boundaries") && hash !== source.hash)
        throw new Error(`${boundary.id}: pinned boundary content changed (${hash})`)
      inputs.push({ ...source, hash })

      const metadata = {
        url: source.url,
        sha256: digest(bytes),
        hash,
        retrieved: new Date().toISOString(),
        features,
      }

      snapshots.push(
        "selection" in source ? { ...metadata, selection: source.selection } : metadata,
      )
    }

    pinned.push({ ...boundary, inputs })

    const data = Schema.decodeSync(snapshot)({
      country: boundary.country,
      credit: boundary.credit,
      inputs: snapshots,
    })

    writeFileSync(
      new URL(`../.archive/sources/${boundary.id}.json.gz`, import.meta.url),
      gzipSync(JSON.stringify(data)),
    )
  }

  if (process.argv.includes("--pin-boundaries")) writeFileSync(file, `${JSON.stringify(pinned)}\n`)
}

export const boundaryCredit = (country: Country) => {
  const boundary = sources().find((entry) => entry.country === country)

  if (boundary === undefined) throw new Error(`No boundary source for ${country}`)

  return boundary.credit
}

export const readBoundary = ({
  country,
  id,
  codes,
  context = [],
}: {
  country: Country
  id: string
  codes: ReadonlyArray<string>
  context?: ReadonlyArray<{ readonly codes: ReadonlyArray<string> }>
}) => {
  const boundary = sources().find((entry) => entry.country === country)

  const data = Schema.decodeUnknownSync(snapshot)(
    JSON.parse(
      gunzipSync(
        readFileSync(new URL(`../.archive/sources/${id}.json.gz`, import.meta.url)),
      ).toString("utf8"),
    ),
  )

  if (
    data.country !== country ||
    boundary?.inputs.length !== data.inputs.length ||
    JSON.stringify(data.credit) !== JSON.stringify(boundary.credit)
  )
    throw new Error(`Wrong boundary snapshot for ${id}`)

  for (const [index, part] of data.inputs.entries()) {
    const source = boundary.inputs[index]

    if (
      part.url !== source?.url ||
      JSON.stringify(part.selection) !==
        JSON.stringify(
          source !== undefined && "selection" in source ? source.selection : undefined,
        ) ||
      part.hash !== source.hash ||
      digest(JSON.stringify(part.features)) !== part.hash
    )
      throw new Error(`Invalid pinned boundary input for ${id}`)
  }

  const features = data.inputs.flatMap((part) => part.features)
  const found = new Set(features.map((part) => part.properties.code))

  const expected = new Set([
    ...codes,
    ...context.flatMap((part) => part.codes),
    ...(boundary.coast === undefined ? [] : [boundary.coast]),
  ])

  if (found.size !== expected.size || [...expected].some((code) => !found.has(code)))
    throw new Error(`${id}: unexpected administrative divisions`)

  const clipped = boundary.coast === undefined ? features : clipBoundaries(features, boundary.coast)

  return cutBoundaries(clipped, boundary.cuts ?? []).map((part) => ({
    type: part.type,
    geometry: part.geometry,
    properties: { code: part.properties.code, name: part.properties.name },
  }))
}
