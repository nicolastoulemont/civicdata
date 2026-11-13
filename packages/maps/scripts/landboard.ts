import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync, gzipSync } from "node:zlib"

import { Schema } from "effect"

import { counties } from "./countries.ts"
import { geometry } from "./lands.ts"

const url =
  "https://gsavalik.envir.ee/geoserver/ehak/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=ehak%3Amaakondade_piirid&outputFormat=application%2Fjson&srsName=EPSG%3A4326&sortBy=ehak_kood"

// GeoServer's envelope has a request timestamp; the decoded features identify this release.
const featuresSha256 = "fe37c00f464db30ae0bc940fc836498de616f142ea53ad72d9311551101dd14f"
const valid = "2026-11-12"
const file = new URL("../.archive/sources/estonia.json.gz", import.meta.url)

const collection = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  numberMatched: Schema.Literal(15),
  numberReturned: Schema.Literal(15),
  timeStamp: Schema.NonEmptyString,
  crs: Schema.Struct({
    type: Schema.Literal("name"),
    properties: Schema.Struct({
      name: Schema.Literal("urn:ogc:def:crs:EPSG::4326"),
    }),
  }),
  features: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("Feature"),
      properties: Schema.Struct({
        fid: Schema.Finite,
        ehak_kood: Schema.Literals(counties),
        maakond: Schema.NonEmptyString,
        tyyp: Schema.Literal("maakond"),
        vers_algus: Schema.NonEmptyString,
        vers_lopp: Schema.Null,
        seaduslik_alus: Schema.NonEmptyString,
      }),
      geometry,
    }),
  ),
})

const snapshot = Schema.Struct({
  source: Schema.Literal(url),
  sha256: Schema.NonEmptyString,
  featuresSha256: Schema.Literal(featuresSha256),
  valid: Schema.Literal(valid),
  retrieved: Schema.NonEmptyString,
  ...collection.fields,
})

const check = (data: typeof collection.Type) => {
  const hash = createHash("sha256").update(JSON.stringify(data.features)).digest("hex")

  if (hash !== featuresSha256) throw new Error(`Estonia's pinned county features changed: ${hash}`)
  const codes = new Set(data.features.map((feature) => feature.properties.ehak_kood))

  if (data.features.length !== 15 || codes.size !== 15)
    throw new Error("Expected 15 distinct Estonian counties")
}

export const refreshLandBoard = async () => {
  const response = await fetch(url)

  if (!response.ok)
    throw new Error(`Estonian Land and Spatial Development Board: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const data = Schema.decodeUnknownSync(collection)(JSON.parse(bytes.toString("utf8")))

  check(data)
  writeFileSync(
    file,
    gzipSync(
      JSON.stringify({
        source: url,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        featuresSha256,
        valid,
        retrieved: new Date().toISOString(),
        ...data,
      }),
    ),
  )
}

export const readLandBoard = () => {
  const data = Schema.decodeUnknownSync(snapshot)(
    JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")),
  )

  check(data)

  return data.features.map((feature) => ({
    type: feature.type,
    geometry: feature.geometry,
    properties: {
      code: feature.properties.ehak_kood,
      name: feature.properties.maakond.replace(/ maakond$/, ""),
    },
  }))
}
