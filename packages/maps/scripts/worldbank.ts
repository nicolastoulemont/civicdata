import { Country } from "@repo/domain"
import { Schema } from "effect"

import { withDatabase } from "./database.ts"

export const worldBankSelection = Schema.Struct({ country: Country })

// The publisher's Admin 1 parquet keeps native names and codes in eight columns.
// Filter in the reader so a country import does not materialize global geometry.
export const readWorldBank = (url: string, { country }: { readonly country: Country }) =>
  withDatabase(async (connection) => {
    const reader = await connection.runAndReadAll(
      `SELECT json_object('type', 'Feature', 'geometry', ST_AsGeoJSON(geometry),
        'properties', json_object('ISO_A3', ISO_A3, 'ISO_A2', ISO_A2, 'WB_A3', WB_A3,
          'WB_REGION', WB_REGION, 'WB_STATUS', WB_STATUS, 'NAM_0', NAM_0,
          'NAM_1', NAM_1, 'ADM1CD_c', ADM1CD_c))::VARCHAR
        FROM read_parquet($url) WHERE ISO_A3=$country ORDER BY ADM1CD_c`,
      { url, country },
    )

    const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Tuple([Schema.String])))(
      reader.getRowsJS(),
    )

    if (rows.length === 0) throw new Error(`Empty World Bank boundaries: ${country}`)

    return new TextEncoder().encode(
      `{"type":"FeatureCollection","features":[${rows.map(([feature]) => feature).join(",")}]}`,
    )
  })
