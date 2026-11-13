import { readFileSync, writeFileSync } from "node:fs"

import { Schema } from "effect"

import { councils } from "./countries.ts"
import { download } from "./download.ts"
import { geometry } from "./lands.ts"

// Every polygon part is fetched in stable OBJECTID order. Hashes pin all five pages.
const requests = [
  {
    source:
      "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/LocalAuthorities_NationalStatutoryBoundaries_Ungeneralised_2024/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2CENG_NAME_VALUE&outSR=4326&orderByFields=OBJECTID&geometryPrecision=5&maxAllowableOffset=0.0001&resultOffset=0&resultRecordCount=2000&f=geojson",
    sha256: "84a90db144fa9c20c9c11c40601845a2751f648438e8fff5a061a28a94d10f48",
    count: 2000,
  },
  {
    source:
      "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/LocalAuthorities_NationalStatutoryBoundaries_Ungeneralised_2024/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2CENG_NAME_VALUE&outSR=4326&orderByFields=OBJECTID&geometryPrecision=5&maxAllowableOffset=0.0001&resultOffset=2000&resultRecordCount=2000&f=geojson",
    sha256: "33ed2109fea7e54a1b925837435601b8fd0019140bf5c607cc8e63cd442bcfc4",
    count: 2000,
  },
  {
    source:
      "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/LocalAuthorities_NationalStatutoryBoundaries_Ungeneralised_2024/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2CENG_NAME_VALUE&outSR=4326&orderByFields=OBJECTID&geometryPrecision=5&maxAllowableOffset=0.0001&resultOffset=4000&resultRecordCount=2000&f=geojson",
    sha256: "5d37051fc4f3d08fab19b9a5b2d52e9144a6c5080b4bc1850e2f9c04a3dde469",
    count: 2000,
  },
  {
    source:
      "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/LocalAuthorities_NationalStatutoryBoundaries_Ungeneralised_2024/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2CENG_NAME_VALUE&outSR=4326&orderByFields=OBJECTID&geometryPrecision=5&maxAllowableOffset=0.0001&resultOffset=6000&resultRecordCount=2000&f=geojson",
    sha256: "9ac3aaa0d02935d0633e563854409aa782ed3320ec9884eca4dd6089bc27f439",
    count: 2000,
  },
  {
    source:
      "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/LocalAuthorities_NationalStatutoryBoundaries_Ungeneralised_2024/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2CENG_NAME_VALUE&outSR=4326&orderByFields=OBJECTID&geometryPrecision=5&maxAllowableOffset=0.0001&resultOffset=8000&resultRecordCount=2000&f=geojson",
    sha256: "34b7a734b7765bbb434d574803572d5094eecf9e39035db9cae97e452641f7ae",
    count: 1161,
  },
]

const file = new URL("../.archive/sources/ireland.json", import.meta.url)

const collection = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("Feature"),
      properties: Schema.Struct({
        OBJECTID: Schema.Finite,
        ENG_NAME_VALUE: Schema.Literals(councils),
      }),
      geometry,
    }),
  ),
})

const snapshot = Schema.Struct({
  retrieved: Schema.NonEmptyString,
  pages: Schema.Array(
    Schema.Struct({
      source: Schema.NonEmptyString,
      sha256: Schema.NonEmptyString,
      ...collection.fields,
    }),
  ),
})

export const refreshTailte = async () => {
  const pages = await Promise.all(
    requests.map(async (request) => {
      const data = await download(collection, request)

      if (data.features.length !== request.count) throw new Error("Incomplete Irish boundary page")

      return { source: request.source, sha256: request.sha256, ...data }
    }),
  )

  writeFileSync(file, `${JSON.stringify({ retrieved: new Date().toISOString(), pages })}\n`)
}

export const readTailte = () => {
  const data = Schema.decodeUnknownSync(snapshot)(JSON.parse(readFileSync(file, "utf8")))

  if (data.pages.length !== requests.length) throw new Error("Missing Irish boundary pages")

  for (const [index, page] of data.pages.entries()) {
    const request = requests[index]

    if (
      page.source !== request?.source ||
      page.sha256 !== request.sha256 ||
      page.features.length !== request.count
    )
      throw new Error("Wrong Irish boundary page")
  }

  const features = data.pages.flatMap((page) => page.features)
  const ids = new Set(features.map((feature) => feature.properties.OBJECTID))
  const areas = new Set(features.map((feature) => feature.properties.ENG_NAME_VALUE))

  if (ids.size !== 9161 || features.length !== 9161 || areas.size !== councils.length)
    throw new Error("Ireland's map must contain all 9161 parts of its 31 local authorities")

  return features.map((feature) => {
    const code = feature.properties.ENG_NAME_VALUE

    const name = code
      .replace(/ COUNCIL$/, "")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .replace(" And ", " and ")
      .replace("Dun Laoghaire", "Dún Laoghaire")

    return { type: feature.type, geometry: feature.geometry, properties: { code, name } }
  })
}
