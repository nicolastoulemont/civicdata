import { Schema } from "effect"

const coordinates = Schema.Struct({
  lng: Schema.NonEmptyArray(Schema.Finite),
  lat: Schema.NonEmptyArray(Schema.Finite),
})

const polygons = Schema.Array(Schema.Array(Schema.Array(coordinates)))
const widget = Schema.Struct({ x: Schema.Record(Schema.String, Schema.Unknown) })
const column = Schema.Array(Schema.NonEmptyString)

// CBS publishes its current census geometry inside two R htmlwidgets: the
// Leaflet polygons and the accompanying neighbourhood-to-geozone table.
export const readCuracao = (html: string) => {
  const widgets = [...html.matchAll(/<script type="application\/json"[^>]*>(.*?)<\/script>/gs)]
    .slice(0, 2)
    .map((match) => Schema.decodeUnknownSync(widget)(JSON.parse(match[1] ?? "")))

  const calls = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ method: Schema.String, args: Schema.Array(Schema.Unknown) })),
  )(widgets[0]?.x["calls"])

  const layer = calls.find((call) => call.method === "addPolygons")
  const neighbourhoods = Schema.decodeUnknownSync(polygons)(layer?.args[0])
  const labels = Schema.decodeUnknownSync(column)(layer?.args[4])

  const data = Schema.decodeUnknownSync(Schema.Array(Schema.Array(Schema.Unknown)))(
    widgets[1]?.x["data"],
  )

  const names = Schema.decodeUnknownSync(column)(data[0])
  const zones = Schema.decodeUnknownSync(column)(data[1])
  const membership = new Map<string, string>()

  for (const [index, name] of names.entries()) {
    const zone = zones[index]

    if (zone === undefined || (membership.has(name) && membership.get(name) !== zone))
      throw new Error(`Ambiguous Curaçao geozone for ${name}`)
    membership.set(name, zone)
  }

  const seen = new Set<string>()

  const features = neighbourhoods.flatMap((boundary, index) => {
    const name = labels[index]?.match(/^<b>(.*?)<\/b>/)?.[1]
    const zone = name === undefined ? undefined : membership.get(name)

    if (zone === undefined) throw new Error(`Missing Curaçao geozone for ${name}`)
    const key = JSON.stringify([name, boundary])

    if (seen.has(key)) return []
    seen.add(key)

    return [
      {
        type: "Feature",
        properties: { code: zone, name: zone, neighbourhood: name },
        geometry: {
          type: "MultiPolygon",
          coordinates: boundary.map((polygon) =>
            polygon.map((ring) =>
              ring.lng.map((lng, point) => {
                const lat = ring.lat[point]

                if (lat === undefined || ring.lat.length !== ring.lng.length)
                  throw new Error("Unpaired Curaçao coordinates")

                return [lng, lat]
              }),
            ),
          ),
        },
      },
    ]
  })

  return { type: "FeatureCollection", features }
}
