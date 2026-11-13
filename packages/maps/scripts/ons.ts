import { readFileSync, writeFileSync } from "node:fs"

import { Schema } from "effect"

import { download } from "./download.ts"
import { geometry } from "./lands.ts"

const url =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/ITL1_JAN_2025_UK_BUC/FeatureServer/0/query?where=1%3D1&outFields=ITL125CD%2CITL125NM&outSR=4326&orderByFields=ITL125CD&f=geojson"

const sha256 = "d3b0ac15b9fa01d5ed2f1d3d6f7f04f6c1b33cbd96bf5768b627d3a63af44e17"
const file = new URL("../.archive/sources/united-kingdom.json", import.meta.url)

const code = Schema.Literals([
  "TLC",
  "TLD",
  "TLE",
  "TLF",
  "TLG",
  "TLH",
  "TLI",
  "TLJ",
  "TLK",
  "TLL",
  "TLM",
  "TLN",
])

const collection = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("Feature"),
      properties: Schema.Struct({ ITL125CD: code, ITL125NM: Schema.NonEmptyString }),
      geometry,
    }),
  ),
})

const snapshot = Schema.Struct({
  source: Schema.Literal(url),
  sha256: Schema.Literal(sha256),
  retrieved: Schema.NonEmptyString,
  ...collection.fields,
})

export const refreshONS = async () => {
  const data = await download(collection, { source: url, sha256 })
  writeFileSync(
    file,
    `${JSON.stringify({ source: url, sha256, retrieved: new Date().toISOString(), ...data })}\n`,
  )
}

export const readONS = () => {
  const data = Schema.decodeUnknownSync(snapshot)(JSON.parse(readFileSync(file, "utf8")))
  const codes = new Set(data.features.map((feature) => feature.properties.ITL125CD))

  if (codes.size !== 12 || data.features.length !== 12)
    throw new Error("ONS's UK map must contain 12 distinct ITL1 regions")

  return data.features.map((feature) => ({
    type: feature.type,
    geometry: feature.geometry,
    properties: { code: feature.properties.ITL125CD, name: feature.properties.ITL125NM },
  }))
}
