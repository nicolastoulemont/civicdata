import { readFileSync, writeFileSync } from "node:fs"

import { Match, Schema } from "effect"

import { countryMaps, type CountryMap } from "./countries.ts"
import { download } from "./download.ts"

const url =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson"

const sha256 = "22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5"
const position = Schema.mutable(Schema.Tuple([Schema.Finite, Schema.Finite]))
const ring = Schema.mutable(Schema.NonEmptyArray(position))
const polygon = Schema.mutable(Schema.NonEmptyArray(ring))

export const geometry = Schema.Union([
  Schema.Struct({ type: Schema.Literal("Polygon"), coordinates: polygon }),
  Schema.Struct({
    type: Schema.Literal("MultiPolygon"),
    coordinates: Schema.mutable(Schema.NonEmptyArray(polygon)),
  }),
])

const land = Schema.Struct({
  type: Schema.Literal("Feature"),
  properties: Schema.Struct({
    adm0_a3: Schema.String,
    adm1_code: Schema.NonEmptyString,
    iso_3166_2: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
    region: Schema.NullOr(Schema.String),
    region_cod: Schema.NullOr(Schema.String),
  }),
  geometry,
})

const collection = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.Array(land),
})

const snapshot = Schema.Struct({
  source: Schema.Literal(url),
  sha256: Schema.Literal(sha256),
  retrieved: Schema.NonEmptyString,
  features: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("Feature"),
      properties: Schema.Struct({
        adm0_a3: Schema.NonEmptyString,
        adm1_code: Schema.NonEmptyString,
        iso_3166_2: Schema.NonEmptyString,
        name: Schema.NullOr(Schema.NonEmptyString),
        region: Schema.NullOr(Schema.String),
        region_cod: Schema.NullOr(Schema.String),
      }),
      geometry,
    }),
  ),
})

// Fetch once per explicit refresh; normal generation reads snapshots offline.
export const refreshLands = async () => {
  const atlas = await download(collection, { source: url, sha256 })

  const retrieved = new Date().toISOString()

  for (const map of countryMaps) {
    if (map.source !== "NaturalEarth") continue

    const data = Schema.decodeUnknownSync(snapshot)({
      source: url,
      sha256,
      retrieved,
      features: atlas.features.filter((feature) =>
        (map.members ?? [map.country]).includes(feature.properties.adm0_a3),
      ),
    })

    writeFileSync(
      new URL(`../.archive/sources/${map.id}.json`, import.meta.url),
      `${JSON.stringify(data)}\n`,
    )
  }
}

export const readCountry = (map: Extract<CountryMap, { source: "NaturalEarth" }>) => {
  const data = Schema.decodeUnknownSync(snapshot)(
    JSON.parse(
      readFileSync(new URL(`../.archive/sources/${map.id}.json`, import.meta.url), "utf8"),
    ),
  )

  const features = data.features.flatMap((feature) => {
    const { properties } = feature

    if (!(map.members ?? [map.country]).includes(properties.adm0_a3))
      throw new Error(`Wrong country in ${map.id}`)

    if (map.omit?.includes(properties.iso_3166_2)) return []
    // Natural Earth assigns Melilla Ceuta's region code; the city ISO codes are distinct.
    const city = properties.iso_3166_2 === "ES-CE" || properties.iso_3166_2 === "ES-ML"

    // The atlas repeats codes for Bogotá/Cundinamarca and Požega-Slavonia/Brod-Posavina.
    const native =
      map.identifier === "adm1_code"
        ? properties.adm1_code
        : Match.value(properties).pipe(
            Match.when({ adm0_a3: "COL", name: "Bogota", iso_3166_2: "CO-CUN" }, () => "CO-DC"),
            Match.when({ adm0_a3: "HRV", adm1_code: "HRV-1604" }, () => "HR-11"),
            Match.when({ adm0_a3: "PER", adm1_code: "PER-587" }, () => "PE-LMA"),
            Match.orElse((part) => part.iso_3166_2),
          )

    const grouped =
      properties.iso_3166_2 === "AU-X03~"
        ? "AU-TAS"
        : map.level === "division" || city
          ? native
          : properties.region_cod?.trim()

    const code = grouped === undefined ? undefined : (map.joins?.[grouped] ?? grouped)

    // Macquarie belongs to Tasmania; Lord Howe belongs to New South Wales.
    const parent =
      map.country === "AUS"
        ? data.features.find((part) => part.properties.iso_3166_2 === code)?.properties.name
        : map.level === "region"
          ? properties.region
          : properties.name

    const name = code === undefined ? undefined : (map.names?.[code] ?? parent)

    if (!code || !name) throw new Error(`No region for ${properties.iso_3166_2}`)

    return [{ type: feature.type, geometry: feature.geometry, properties: { code, name } }]
  })

  const codes = new Set(features.map((feature) => feature.properties.code))

  const expected = new Set([...map.codes, ...(map.context ?? []).flatMap((part) => part.codes)])

  if (codes.size !== expected.size || [...expected].some((code) => !codes.has(code)))
    throw new Error(`${map.id}: unexpected subdivision identifiers`)

  return features
}
