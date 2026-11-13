// Writes src/data/: the world and each region's map as its own
// module, every country's outline projected once so neither the browser nor
// the link-preview card projects at request time, and sheets.gen.ts, which
// imports one when a map of it is drawn. Run with
// `pnpm --filter @repo/maps run generate`, then `pnpm format`, after changing
// a region, a frame or the source maps.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { Country, type Region, regions } from "@repo/domain"
import {
  geoArea,
  geoAzimuthalEqualArea,
  geoCentroid,
  geoEqualEarth,
  type GeoPermissibleObjects,
  type GeoProjection,
  geoPath,
} from "d3-geo"
import { Match, Schema } from "effect"
import { strToU8, zipSync } from "fflate"
import type {
  FeatureCollection,
  GeometryCollection as Geometries,
  MultiPoint,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson"
import { feature, merge, mergeArcs } from "topojson-client"
import { topology } from "topojson-server"
import type {
  GeometryCollection,
  GeometryObject,
  MultiPolygon as Arcs,
  Polygon as Arc,
  Topology,
} from "topojson-specification"

import { boundaryCredit, readBoundary, refreshBoundaries } from "./boundaries.ts"
import { countryMaps, type CountryMap } from "./countries.ts"
import { readLandBoard, refreshLandBoard } from "./landboard.ts"
import { readCountry, refreshLands } from "./lands.ts"
import { readONS, refreshONS } from "./ons.ts"
import { readTailte, refreshTailte } from "./tailte.ts"

const read = (file: string) => readFileSync(new URL(import.meta.resolve(file)), "utf8")

type Countries = Topology<{ countries: GeometryCollection<{ name: string }> }>

// How detailed Natural Earth's outlines are: 1:110m for the world, 1:50m for
// most regions, 1:10m for the smallest.
type Detail = "110m" | "50m" | "10m"

// Natural Earth draws who holds the land, so its Russia holds Crimea. Our
// maps draw Crimea in Ukraine, as the EU, whose statistics office we chart,
// and the UN General Assembly do: its polygon, Sevastopol included, moves
// from Russia's outline into Ukraine's, without a border between them.
const ukrainian = (atlas: Countries): Countries => {
  const { geometries } = atlas.objects.countries
  const areas = geometries.filter(isArea)
  const russia = areas.find((geometry) => geometry.properties?.name === "Russia")
  const ukraine = areas.find((geometry) => geometry.properties?.name === "Ukraine")

  if (russia?.type !== "MultiPolygon" || ukraine === undefined)
    throw new Error("Natural Earth no longer draws Russia and Ukraine as it did")

  const crimean = (arcs: Array<Array<number>>) => {
    const [x, y] = geoCentroid(feature(atlas, { type: "Polygon", arcs }))

    return x > 32 && x < 37 && y > 44 && y < 46.5
  }

  const crimea = russia.arcs.filter(crimean)

  if (crimea.length !== 1) throw new Error(`Found ${crimea.length} polygons of Crimea, not 1`)

  const moved = {
    ...russia,
    arcs: russia.arcs.filter((arcs) => !crimean(arcs)),
  }

  const joined = {
    ...mergeArcs(atlas, [ukraine, { type: "MultiPolygon", arcs: crimea }]),
    id: ukraine.id,
    properties: ukraine.properties,
  }

  return {
    ...atlas,
    objects: {
      countries: {
        ...atlas.objects.countries,
        geometries: geometries.map((geometry) =>
          geometry === russia ? moved : geometry === ukraine ? joined : geometry,
        ),
      },
    },
  }
}

const isArea = (
  geometry: GeometryObject<{ name: string }>,
): geometry is Arc<{ name: string }> | Arcs<{ name: string }> =>
  geometry.type === "Polygon" || geometry.type === "MultiPolygon"

// Natural Earth country outlines, keyed by ISO 3166-1 numeric code.
const atlas: Record<Detail, Countries> = {
  "110m": ukrainian(JSON.parse(read("world-atlas/countries-110m.json"))),
  "50m": ukrainian(JSON.parse(read("world-atlas/countries-50m.json"))),
  "10m": ukrainian(JSON.parse(read("world-atlas/countries-10m.json"))),
}

// [alpha-2, alpha-3, numeric] for every ISO 3166-1 country.
const codes: ReadonlyArray<readonly [string, string, string]> = JSON.parse(
  read("i18n-iso-countries/codes.json"),
)

const alpha3 = new Map(codes.map(([, three, numeric]) => [numeric, three]))
const isCountry = Schema.is(Country)

// The World Bank's code for a Natural Earth country, if it publishes data for
// it. Kosovo has no ISO code, so the World Bank calls it XKX; Jersey and
// Guernsey are its Channel Islands, CHI.
const codeOf = (name: string | undefined, id: string | number | undefined) => {
  const code =
    name === "Kosovo"
      ? "XKX"
      : name === "Jersey" || name === "Guernsey"
        ? "CHI"
        : alpha3.get(`${id}`)

  return isCountry(code) ? code : undefined
}

type Ring = Array<readonly [number, number]>

// The projected rings of an area, in whole units, with repeated points
// dropped. The projection clips them at the edge of its map.
const ringsOf = (projection: GeoProjection, area: GeoPermissibleObjects) => {
  const rings: Array<Ring> = []

  const add = (x: number, y: number) => {
    const point = [Math.round(x), Math.round(y)] as const
    const ring = rings.at(-1)
    const last = ring?.at(-1)

    if (ring !== undefined && (last === undefined || last[0] !== point[0] || last[1] !== point[1]))
      ring.push(point)
  }

  geoPath(projection, {
    beginPath: () => undefined,
    moveTo: (x, y) => {
      rings.push([])
      add(x, y)
    },
    lineTo: add,
    closePath: () => undefined,
    arc: () => undefined,
  })(area)

  return rings.filter((ring) => ring.length >= 3)
}

// Each ring as whole numbers: its first point, then the step to each next one.
const stepsOf = (rings: ReadonlyArray<Ring>) =>
  rings.map((ring) =>
    ring.flatMap(([x, y], index) => {
      const previous = ring[index - 1]

      return previous === undefined ? [x, y] : [x - previous[0], y - previous[1]]
    }),
  )

const hasArea = (ring: Ring) => {
  const [first, second, ...rest] = ring

  return (
    first !== undefined &&
    second !== undefined &&
    rest.some(
      ([x, y]) =>
        (second[0] - first[0]) * (y - first[1]) !== (second[1] - first[1]) * (x - first[0]),
    )
  )
}

const sizeOf = (projection: GeoProjection, area: GeoPermissibleObjects) => {
  const [, [right, bottom]] = geoPath(projection).bounds(area)

  return { width: Math.ceil(right), height: Math.ceil(bottom) }
}

const folder = new URL("../src/data/", import.meta.url)

// A map's id as its module's export: "north-america" → northAmerica.
const nameOf = (id: string) => id.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())

const write = (id: string, { detail, sheet }: { detail: Detail; sheet: object }) =>
  writeFileSync(
    new URL(`${id}.gen.ts`, folder),
    `// Generated by scripts/maps.ts from Natural Earth 1:${detail} country outlines
// (public domain, https://www.naturalearthdata.com) via world-atlas. Do not edit.
import type { Sheet } from "../index.ts"

export const ${nameOf(id)}: Sheet = ${JSON.stringify(sheet)}
`,
  )

// The world in the Equal Earth projection, 1000 units wide, with each World
// Bank economy large enough to draw at this scale. d3 clips Russia and Fiji
// at the edge.
const drawWorld = () => {
  const sphere: GeoPermissibleObjects = { type: "Sphere" }
  const projection = geoEqualEarth().fitWidth(1000, sphere)
  const source = atlas["110m"]

  const outlines = feature(source, source.objects.countries).features.flatMap((place) => {
    const code = codeOf(place.properties.name, place.id)

    return code === undefined ? [] : [[code, stepsOf(ringsOf(projection, place))]]
  })

  write("world", {
    detail: "110m",
    sheet: {
      ...sizeOf(projection, sphere),
      outlines: Object.fromEntries(outlines),
      land: [],
      insets: [],
    },
  })
}

// West, south, east and north in degrees. West is greater than east when the
// box crosses the 180th meridian.
type Box = readonly [number, number, number, number]

const within =
  ([west, south, east, north]: Box) =>
  ([x = 0, y = 0]: Position) => {
    const across = west <= east ? x >= west && x <= east : x >= west || x <= east

    return across && y >= south && y <= north
  }

const inside = (box: Box) => (polygon: ReadonlyArray<Array<Position>>) =>
  within(box)(geoCentroid({ type: "Polygon", coordinates: [...polygon] }))

// A part of a country drawn in its own box beside the map, found by the box
// its land lies in.
interface Away {
  readonly name: string
  readonly country: Country
  readonly box: Box
}

// The EU's outermost regions. Natural Earth draws them as parts of France,
// Spain and Portugal.
const outermost: ReadonlyArray<Away> = [
  { name: "Guadeloupe", country: "FRA", box: [-62, 15.7, -60.9, 16.6] },
  { name: "Martinique", country: "FRA", box: [-61.3, 14.3, -60.7, 15] },
  { name: "French Guiana", country: "FRA", box: [-55, 1.5, -51, 6] },
  { name: "Réunion", country: "FRA", box: [55, -21.5, 56, -20.7] },
  { name: "Mayotte", country: "FRA", box: [44.9, -13.1, 45.4, -12.5] },
  { name: "Canaries", country: "ESP", box: [-18.5, 27.4, -13, 29.5] },
  { name: "Azores", country: "PRT", box: [-31.5, 36.7, -24.8, 40] },
  { name: "Madeira", country: "PRT", box: [-17.5, 32.3, -16, 33.2] },
]

const hawaii: Away = { name: "Hawaii", country: "USA", box: [-160.5, 18.8, -154.7, 22.3] }

// How each region is drawn: a Lambert azimuthal equal-area projection centred
// on `centre`, framed on the parts of its countries whose middle lies in
// `box`. Parts outside it, e.g. Svalbard on the map of Europe, fall outside
// the frame, and `insets` move to their own boxes. A country in `cut` is too
// large for the frame: the frame reaches as far as its land inside `box`,
// and the rest falls off the edge, e.g. Russia east of the Urals.
interface Frame {
  readonly centre: readonly [number, number]
  readonly box: Box
  readonly detail: Detail
  readonly insets?: ReadonlyArray<Away>
  readonly cut?: ReadonlyArray<Country>
}

const frames: Record<Region["id"], Frame> = {
  baltics: { centre: [24, 57], box: [20, 53, 29, 60], detail: "10m" },
  "western-balkans": { centre: [20, 42.5], box: [13, 39, 24, 47], detail: "10m" },
  "south-caucasus": { centre: [45, 41], box: [39, 38, 51, 44], detail: "10m" },
  gulf: { centre: [50, 24], box: [34, 12, 60, 33], detail: "10m" },
  caribbean: { centre: [-72, 18], box: [-86, 9, -58, 28], detail: "10m" },
  "central-america": { centre: [-95, 18], box: [-118, 6, -76, 33], detail: "50m" },
  nordics: { centre: [12, 64], box: [-25, 54, 32, 72], detail: "50m" },
  "west-africa": { centre: [-5, 13], box: [-26, 3, 16, 28], detail: "50m" },
  "central-africa": { centre: [18, 2], box: [5, -19, 32, 24], detail: "50m" },
  "east-africa": { centre: [40, 0], box: [21, -13, 57, 23], detail: "50m" },
  "southern-africa": { centre: [30, -20], box: [11, -35, 64, -4], detail: "50m" },
  "north-africa": { centre: [10, 25], box: [-18, 8, 38, 38], detail: "50m" },
  "middle-east": { centre: [44, 28], box: [25, 12, 64, 43], detail: "50m" },
  "central-asia": { centre: [64, 44], box: [46, 35, 88, 56], detail: "50m" },
  "south-asia": { centre: [72, 22], box: [43, -2, 98, 40], detail: "50m" },
  "southeast-asia": { centre: [115, 6], box: [91, -12, 142, 29], detail: "50m" },
  "east-asia": { centre: [112, 36], box: [72, 17, 150, 54], detail: "50m" },
  australia: { centre: [155, -27], box: [110, -55, -170, 0], detail: "50m" },
  europe: { centre: [10, 52], box: [-25, 34, 47, 72], detail: "50m", insets: outermost },
  "extended-europe": {
    centre: [20, 54],
    box: [-25, 34, 60, 72],
    detail: "50m",
    insets: outermost,
    cut: ["RUS"],
  },
  "south-america": { centre: [-60, -20], box: [-92, -57, -34, 13], detail: "50m" },
  "latin-america": { centre: [-75, -5], box: [-118, -57, -32, 33], detail: "50m" },
  "north-america": {
    centre: [-100, 50],
    box: [-170, 14, -10, 84],
    detail: "50m",
    insets: [hawaii],
  },
  "sub-saharan-africa": { centre: [20, -5], box: [-26, -35, 64, 28], detail: "50m" },
  africa: { centre: [17, 2], box: [-26, -35, 64, 38], detail: "50m" },
  "northeast-asia": { centre: [105, 55], box: [19, 17, -168, 82], detail: "50m" },
  "post-soviet": { centre: [75, 55], box: [19, 35, -168, 82], detail: "50m" },
  oceania: { centre: [175, -15], box: [110, -55, -130, 21], detail: "50m" },
  americas: {
    centre: [-80, 15],
    box: [-170, -57, -10, 84],
    detail: "50m",
    insets: [hawaii],
  },
}

const polygonsOf = (geometry: Polygon | MultiPolygon) =>
  geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates

const multi = (polygons: ReadonlyArray<Array<Array<Position>>>): MultiPolygon => ({
  type: "MultiPolygon",
  coordinates: [...polygons],
})

// Each inset's box is 120 by 90 units, its land fitted inside with a margin.
const inset = { width: 120, height: 90, margin: 8 }

// A region's map, 1000 units wide. Every country outside the region is land,
// drawn as one shape around it.
const drawRegion = ({ id, countries }: Region) => {
  const { centre, box, detail, insets = [], cut = [] } = frames[id]
  const source = atlas[detail]
  const members = new Set<Country>(countries)

  const places = feature(source, source.objects.countries).features.flatMap((place) => {
    const code = codeOf(place.properties.name, place.id)
    const { geometry } = place

    return code !== undefined &&
      members.has(code) &&
      (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
      ? [{ code, polygons: polygonsOf(geometry) }]
      : []
  })

  const overseas = insets.map((away) => {
    const lies = inside(away.box)

    const polygons = places
      .filter((place) => place.code === away.country)
      .flatMap((place) => place.polygons.filter(lies))

    if (polygons.length === 0) throw new Error(`No land found for ${away.name} in ${id}`)

    return { ...away, area: multi(polygons) }
  })

  const moved = (polygon: ReadonlyArray<Array<Position>>) =>
    insets.some((away) => inside(away.box)(polygon))

  const framed = inside(box)

  const mainland = places.map(({ code, polygons }) => ({
    code,
    area: multi(polygons.filter((polygon) => !moved(polygon))),
  }))

  const reach: MultiPoint = {
    type: "MultiPoint",
    coordinates: mainland
      .filter(({ code }) => cut.includes(code))
      .flatMap(({ area }) => area.coordinates.flatMap(([outer = []]) => outer))
      .filter(within(box)),
  }

  const frame: Geometries = {
    type: "GeometryCollection",
    geometries: [multi(mainland.flatMap(({ area }) => area.coordinates.filter(framed))), reach],
  }

  for (const { code, area } of mainland) {
    const left = area.coordinates.filter((polygon) => !framed(polygon)).length

    if (left > 0) console.info(`${id}: ${left} parts of ${code} lie outside the frame`)
  }

  // Fitted 980 units wide, then moved 10 in, so no coast touches the edge.
  const projection = geoAzimuthalEqualArea().rotate([-centre[0], -centre[1]]).fitWidth(980, frame)

  const [x, y] = projection.translate()
  const { height } = sizeOf(projection.translate([x + 10, y + 10]), frame)
  const size = { width: 1000, height: height + 10 }

  projection.clipExtent([
    [0, 0],
    [size.width, size.height],
  ])

  const merged = merge(
    source,
    source.objects.countries.geometries.filter(isArea).filter((geometry) => {
      const code = codeOf(geometry.properties?.name, geometry.id)

      return code === undefined || !members.has(code)
    }),
  )

  // d3 reads a ring wound the wrong way as the whole sphere but that ring;
  // merging the 1:10m outlines leaves some so. No land covers a hemisphere,
  // so any polygon that does is turned around.
  const land = orient(merged)

  const outlines = mainland.flatMap(({ code, area }) => {
    const rings = ringsOf(projection, area)

    return rings.length === 0 ? [] : [[code, stepsOf(rings)]]
  })

  write(id, {
    detail,
    sheet: {
      ...size,
      outlines: Object.fromEntries(outlines),
      land: stepsOf(ringsOf(projection, land)),
      insets: overseas.map(({ name, country, area }) => {
        const [longitude, latitude] = geoCentroid(area)

        const fitted = geoAzimuthalEqualArea()
          .rotate([-longitude, -latitude])
          .fitExtent(
            [
              [inset.margin, inset.margin],
              [inset.width - inset.margin, inset.height - inset.margin],
            ],
            area,
          )

        return {
          name,
          country,
          width: inset.width,
          height: inset.height,
          outline: stepsOf(ringsOf(fitted, area)),
        }
      }),
    },
  })
}

const orient = (geometry: MultiPolygon) =>
  multi(
    geometry.coordinates.map((polygon) =>
      geoArea({ type: "Polygon", coordinates: polygon }) > 2 * Math.PI
        ? polygon.map((ring) => ring.toReversed())
        : polygon,
    ),
  )

// Project whole administrative regions, dissolving their source departments or provinces.
const drawCountry = (map: CountryMap) => {
  const lands = Match.value(map).pipe(
    Match.when({ source: "ONS" }, () => readONS()),
    Match.when({ source: "Tailte" }, () => readTailte()),
    Match.when({ source: "LandBoard" }, () => readLandBoard()),
    Match.when({ source: "NaturalEarth" }, readCountry),
    Match.when({ source: "Boundary" }, readBoundary),
    Match.exhaustive,
  )

  const boundaries: FeatureCollection<Polygon | MultiPolygon, { code: string; name: string }> = {
    type: "FeatureCollection",
    features: lands,
  }

  const source = topology({ divisions: boundaries })
  const collection = source.objects["divisions"]

  if (collection?.type !== "GeometryCollection")
    throw new Error("Expected a collection of administrative areas")
  const metadata = Schema.Struct({ code: Schema.NonEmptyString, name: Schema.NonEmptyString })

  const parts = collection.geometries.map((geometry) => {
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
      throw new Error("Administrative areas must be polygons")
    const { code, name } = Schema.decodeUnknownSync(metadata)(geometry.properties)

    const area: Arc | Arcs =
      geometry.type === "Polygon"
        ? { type: "Polygon", arcs: geometry.arcs }
        : { type: "MultiPolygon", arcs: geometry.arcs }

    return { geometry: area, code, name }
  })

  const divisions = map.codes.map((code) => {
    const selected = parts.filter((part) => part.code === code)
    const geometries = selected.map((part) => part.geometry)
    const name = selected[0]?.name

    if (name === undefined) throw new Error(`No name for ${code}`)

    const merged = merge(source, geometries)

    // GeoJSON publishers can use either ring winding; d3 needs small land areas.
    const geometry = orient(merged)

    return { code, name, geometry }
  })

  const offshore = map.offshore ?? []

  const mainland = divisions.flatMap((division) => {
    if (map.insets.some((away) => away.code === division.code && away.detached)) return []

    const polygons = polygonsOf(division.geometry).filter(
      (polygon) =>
        !offshore.some((away) => away.code === division.code && inside(away.box)(polygon)),
    )

    if (polygons.length === 0) throw new Error(`No mainland for ${division.code}`)

    return [{ code: division.code, name: division.name, geometry: multi(polygons) }]
  })

  const context = (map.land ?? []).map((code) => {
    const part = lands.find((candidate) => candidate.properties.code === code)

    if (part === undefined) throw new Error(`No context land for ${code}`)

    return orient(multi(polygonsOf(part.geometry)))
  })

  const land = multi(context.flatMap(polygonsOf))

  const area: Geometries = {
    type: "GeometryCollection",
    geometries: [...mainland.map((division) => division.geometry), ...context],
  }

  const projection = geoAzimuthalEqualArea()
    .rotate([-map.centre[0], -map.centre[1]])
    .fitWidth(980, area)

  const [x, y] = projection.translate()
  projection.translate([x + 10, y + 10])
  const { height } = sizeOf(projection, area)

  const background = stepsOf(ringsOf(projection, land))

  const outlines = mainland.map((division) => ({
    code: division.code,
    name: division.name,
    outline: stepsOf(ringsOf(projection, division.geometry)),
  }))

  const projectInset = (
    geometry: MultiPolygon,
    {
      name,
      code,
      coverage,
    }: {
      name: string
      code?: string
      coverage?: "National" | "Context" | undefined
    },
  ) => {
    if (geometry.coordinates.length === 0) throw new Error(`No land in inset ${name}`)
    const [longitude, latitude] = geoCentroid(geometry)

    const fitted = geoAzimuthalEqualArea()
      .rotate([-longitude, -latitude])
      .fitExtent(
        [
          [8, 8],
          [232, 172],
        ],
        geometry,
      )

    const rings = ringsOf(fitted, geometry)

    if (code !== undefined && !rings.some(hasArea)) throw new Error(`Collapsed named inset ${name}`)
    const outline = stepsOf(rings)

    return {
      name,
      country: map.country,
      coverage,
      width: 240,
      height: 180,
      outline,
      areas: code === undefined ? undefined : [{ code, name, outline }],
    }
  }

  const insets = [
    ...map.insets.map(({ code, box, coverage }) => {
      const division = divisions.find((candidate) => candidate.code === code)

      if (division === undefined) throw new Error(`No geometry for inset ${code}`)

      const geometry =
        box === undefined
          ? division.geometry
          : multi(polygonsOf(division.geometry).filter(inside(box)))

      return projectInset(geometry, { name: division.name, code, coverage })
    }),
    ...offshore.map(({ code, name, box }) => {
      const division = divisions.find((candidate) => candidate.code === code)

      if (division === undefined) throw new Error(`No geometry for offshore part ${code}`)

      return projectInset(multi(polygonsOf(division.geometry).filter(inside(box))), { name })
    }),
    ...(map.context ?? []).map(({ name, codes: members, box }) => {
      const selected = lands.filter((part) => members.includes(part.properties.code))

      const polygons = polygonsOf(
        orient(multi(selected.flatMap((part) => polygonsOf(part.geometry)))),
      )

      const geometry = multi(box === undefined ? polygons : polygons.filter(inside(box)))

      return projectInset(geometry, { name, coverage: "Context" })
    }),
  ]

  const credit = Match.value(map.source).pipe(
    Match.when(
      "ONS",
      () => "ONS ITL1 January 2025 BUC (OGL v3.0; contains OS data, Crown copyright 2025).",
    ),
    Match.when(
      "Tailte",
      () => "Tailte Éireann Local Authorities 2024 (CC BY 4.0), simplified for display.",
    ),
    Match.when("LandBoard", () => "Estonian Land and Spatial Development Board, 12 November 2026."),
    Match.when("NaturalEarth", () => "Natural Earth Admin 1 v5.1.2 (public domain)."),
    Match.when("Boundary", () => JSON.stringify(boundaryCredit(map.country))),
    Match.exhaustive,
  )

  writeFileSync(
    new URL(`${map.id}.gen.ts`, folder),
    `// Generated by scripts/maps.ts from ${credit}
import type { Sheet } from "../index.ts"

const areas = ${JSON.stringify(outlines)}

export const ${nameOf(map.id)}: Sheet = {
  width: 1000, height: ${height + 10},
  outlines: { ${map.country}: areas.flatMap((area) => area.outline) },
  land: ${JSON.stringify(background)}, insets: ${JSON.stringify(insets)},
  subdivisions: { country: "${map.country}", source: "${map.source}", ${map.source === "Boundary" ? `credit: ${JSON.stringify(boundaryCredit(map.country))},` : ""} areas: ${map.insets.length === 0 ? "areas" : `areas.filter((area) => !${JSON.stringify(map.insets.map((away) => away.code))}.includes(area.code))`} },
}
`,
  )

  if (map.source === "Boundary") {
    const publisher = boundaryCredit(map.country)

    if (publisher.license.startsWith("ODbL") || publisher.license.startsWith("CC BY-SA")) {
      const downloads = new URL("../.archive/downloads/", import.meta.url)

      mkdirSync(downloads, { recursive: true })
      writeFileSync(
        new URL(`${map.country}.zip`, downloads),
        zipSync(
          {
            "source.json.gz": readFileSync(
              new URL(`../.archive/sources/${map.id}.json.gz`, import.meta.url),
            ),
            "display.json": strToU8(
              JSON.stringify({
                country: map.country,
                credit: publisher,
                projection: { name: "Lambert azimuthal equal area", centre: map.centre },
                width: 1000,
                height: height + 10,
                areas: outlines,
                insets,
                land: background.length === 0 ? undefined : background,
              }),
            ),
            "NOTICE.txt": strToU8(
              `${publisher.publisher}\n${publisher.url}\n\nAdapted boundary database, including the projected display coordinates.\nLicensed under ${publisher.license}:\n${publisher.licenseUrl}${publisher.license.includes("CC BY 4.0") ? "\nhttps://creativecommons.org/licenses/by/4.0/" : ""}${publisher.license.includes("CC BY 3.0 IGO") ? "\nhttps://creativecommons.org/licenses/by/3.0/igo/" : ""}${publisher.license.includes("CBS attribution terms") ? "\nhttps://www.cbs.cw/disclaimer" : ""}\n\nsource.json.gz retains the selected source features, attributes, hashes and retrieval dates.\ndisplay.json contains the projected outlines and insets used by the map.\n`,
            ),
          },
          { mtime: new Date(1980, 0, 1) },
        ),
      )
    }
  }
}

mkdirSync(folder, { recursive: true })

drawWorld()

if (process.argv.includes("--pin-boundaries")) await refreshBoundaries()

if (process.argv.includes("--refresh-lands")) {
  await refreshLands()
  await refreshONS()
  await refreshTailte()
  await refreshLandBoard()
  await refreshBoundaries()
}

for (const map of countryMaps) drawCountry(map)

for (const region of regions) drawRegion(region)

const ids = ["world", ...regions.map((region) => region.id)]

writeFileSync(
  new URL("sheets.gen.ts", folder),
  `// Generated by scripts/maps.ts. Do not edit.
import type { Country, Region } from "@repo/domain"

import type { Sheet } from "../index.ts"

// Each map as its own module, imported the first time a map of it is drawn.
export const sheets: Record<Region["id"] | "world", () => Promise<Sheet>> = {
${ids.map((id) => `  ${JSON.stringify(id)}: () => import("./${id}.gen.ts").then((module) => module.${nameOf(id)}),`).join("\n")}
}

export const national: Partial<Record<Country, () => Promise<Sheet>>> = {
${countryMaps.map((map) => `  ${map.country}: () => import("./${map.id}.gen.ts").then((module) => module.${nameOf(map.id)}),`).join("\n")}
}
`,
)
