import { Schema } from "effect"

import { withDatabase } from "./database.ts"

export const selection = Schema.Union([
  Schema.Struct({
    country: Schema.NonEmptyString,
    subtype: Schema.Literals([
      "country",
      "dependency",
      "region",
      "county",
      "macrohood",
      "neighborhood",
    ]),
  }),
  Schema.Struct({
    country: Schema.NonEmptyString,
    subtype: Schema.Literal("land"),
    box: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
  }),
])

interface Parameters {
  [name: string]: string
}

interface Source {
  readonly url: string
  readonly selection: typeof selection.Type
}

// One query per pinned release shares HTTP range reads across country extracts.
// Land polygons exclude maritime limits; every original source record is kept.
export const readOverture = async (sources: ReadonlyArray<Source>) => {
  const outputs = new Map<string, Uint8Array>()

  if (sources.length === 0) return outputs

  return withDatabase(async (connection) => {
    // eslint-disable-next-line no-await-in-loop
    for (const url of new Set(sources.map((source) => source.url))) {
      const selected = sources.filter((source) => source.url === url)
      const parameters: Parameters = { url }

      const coast = selected.every((source) => source.selection.subtype === "land")

      const clauses = selected.map((source, index) => {
        parameters[`country${index}`] = source.selection.country

        if (source.selection.subtype !== "land")
          parameters[`subtype${index}`] = source.selection.subtype

        if (source.selection.subtype === "land") {
          const [west, south, east, north] = source.selection.box
          parameters[`west${index}`] = `${west}`
          parameters[`south${index}`] = `${south}`
          parameters[`east${index}`] = `${east}`
          parameters[`north${index}`] = `${north}`

          return `(bbox.xmin < $east${index}::DOUBLE AND bbox.xmax > $west${index}::DOUBLE AND bbox.ymin < $north${index}::DOUBLE AND bbox.ymax > $south${index}::DOUBLE)`
        }

        if (coast) throw new Error("Mixed Overture source layers")

        return `(country=$country${index} AND subtype=$subtype${index})`
      })

      // SQL values are bound, including the release URL and every selector.
      // eslint-disable-next-line no-await-in-loop
      const reader = await connection.runAndReadAll(
        coast
          ? `WITH selected AS (
            SELECT CASE ${clauses.map((clause, index) => `WHEN ${clause} THEN $country${index}`).join(" ")} END AS country,
              id, geometry, sources, version, bbox, class, subtype
            FROM read_parquet($url) WHERE class='land' AND (${clauses.join(" OR ")})
          ) SELECT country, 'land' AS subtype,
            json_object('type', 'Feature', 'geometry', ST_AsGeoJSON(ST_Union_Agg(geometry)),
              'properties', json_object('id', 'Coast', 'name', 'Coast',
                'members', list(json_object('record_id', id, 'geometry', ST_AsGeoJSON(geometry),
                  'sources', sources, 'version', version, 'bbox', bbox, 'class', class, 'subtype', subtype) ORDER BY id)))::VARCHAR
            FROM selected GROUP BY country ORDER BY country`
          : `SELECT country, subtype, json_object('type', 'Feature',
          'geometry', ST_AsGeoJSON(geometry), 'properties', json_object(
            'id', id, 'name', coalesce(names.common['en'], names.primary),
            'names', names, 'country', country, 'subtype', subtype,
            'admin_level', admin_level, 'region', region, 'sources', sources,
            'division_id', division_id, 'version', version, 'bbox', bbox,
            'is_land', is_land, 'is_territorial', is_territorial))::VARCHAR
          FROM read_parquet($url) WHERE is_land AND (${clauses.join(" OR ")}) ORDER BY id`,
        parameters,
      )

      const rows = Schema.decodeUnknownSync(
        Schema.Array(Schema.Tuple([Schema.String, Schema.String, Schema.String])),
      )(reader.getRowsJS())

      for (const source of selected) {
        const features = rows
          .filter(
            ([country, subtype]) =>
              country === source.selection.country && subtype === source.selection.subtype,
          )
          .map(([, , value]) => JSON.parse(value))

        if (features.length === 0)
          throw new Error(`Empty Overture extract: ${source.selection.country}`)
        outputs.set(
          JSON.stringify(source),
          new TextEncoder().encode(JSON.stringify({ type: "FeatureCollection", features })),
        )
      }
    }

    return outputs
  })
}
