import { SeriesKey } from "@repo/domain"
import { Schema } from "effect"

// An opaque identifier within one publisher, stable across releases.
export const AssetId = Schema.NonEmptyString.pipe(Schema.brand("AssetId"))

export type AssetId = typeof AssetId.Type

export const Versions = Schema.Array(
  Schema.Struct({ asset: AssetId, version: Schema.NonEmptyString }),
)

export type Versions = typeof Versions.Type

// Sources assign a monotone integer from their release chronology, never from
// lexical version ordering. Membership lists complete series, grouped by asset.
export const Release = Schema.Struct({
  version: Schema.NonEmptyString,
  order: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  assets: Schema.NonEmptyArray(
    Schema.Struct({
      asset: AssetId,
      members: Schema.NonEmptyArray(SeriesKey),
    }),
  ),
})

export interface Release extends Schema.Schema.Type<typeof Release> {}
