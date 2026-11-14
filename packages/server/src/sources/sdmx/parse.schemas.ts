import { IndicatorId } from "@repo/domain"
import { Schema } from "effect"

export const toIndicator = Schema.decodeUnknownOption(IndicatorId)

export const KeyValue = Schema.Struct({
  id: Schema.String,
  values: Schema.optionalKey(Schema.Array(Schema.String)),
  timeRange: Schema.optionalKey(
    Schema.Struct({
      startPeriod: Schema.optionalKey(Schema.Struct({ period: Schema.String })),
      endPeriod: Schema.optionalKey(Schema.Struct({ period: Schema.String })),
    }),
  ),
})

// The OECD's content constraints: for each dataflow, the codes its data
// takes ("Actual") and the codes its structure allows ("Allowed").
export const Constraints = Schema.Struct({
  data: Schema.Struct({
    contentConstraints: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        constraintAttachment: Schema.Struct({
          dataflows: Schema.optionalKey(Schema.Array(Schema.String)),
        }),
        cubeRegions: Schema.optionalKey(
          Schema.Array(Schema.Struct({ keyValues: Schema.optionalKey(Schema.Array(KeyValue)) })),
        ),
      }),
    ),
  }),
})

// The OECD's data structures: each one's dimensions and the codelist of
// each.
export const DataStructures = Schema.Struct({
  data: Schema.Struct({
    dataStructures: Schema.Array(
      Schema.Struct({
        agencyID: Schema.String,
        id: Schema.String,
        dataStructureComponents: Schema.Struct({
          dimensionList: Schema.Struct({
            dimensions: Schema.Array(
              Schema.Struct({
                id: Schema.String,
                localRepresentation: Schema.optionalKey(
                  Schema.Struct({ enumeration: Schema.optionalKey(Schema.String) }),
                ),
              }),
            ),
          }),
        }),
      }),
    ),
  }),
})

// One Eurostat codelist as JSON-stat, alone or in a collection.
const EurostatCodelist = Schema.Struct({
  category: Schema.Struct({ label: Schema.Record(Schema.String, Schema.String) }),
  extension: Schema.Struct({ id: Schema.String }),
})

export const EurostatCodelists = Schema.Union([
  Schema.Struct({ link: Schema.Struct({ item: Schema.Array(EurostatCodelist) }) }),
  EurostatCodelist,
])

export const OecdCodelists = Schema.Struct({
  data: Schema.Struct({
    codelists: Schema.Array(
      Schema.Struct({
        agencyID: Schema.String,
        id: Schema.String,
        codes: Schema.optionalKey(
          Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
        ),
      }),
    ),
  }),
})
