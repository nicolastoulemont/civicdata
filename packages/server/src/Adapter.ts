import {
  type CatalogEntry,
  type DimensionsMissing,
  IndicatorId,
  type IndicatorNotFound,
  type SourceUnavailable,
} from "@civicdata/domain"
import { Data, type Effect, Schema, type Stream } from "effect"

import type { Codelist, Outline } from "./Outlines.ts"
import type { Answer, Described, Query } from "./Series.ts"
import type { Stored } from "./Store.ts"

// An opaque identifier within one publisher, stable across releases.
export const AssetId = Schema.NonEmptyString.pipe(Schema.brand("AssetId"))

export type AssetId = typeof AssetId.Type

export const Versions = Schema.Array(
  Schema.Struct({ asset: AssetId, version: Schema.NonEmptyString }),
)

export type Versions = typeof Versions.Type

// Read capability is independent of the assets selected for ingestion.
export type Policy = Data.TaggedEnum<{
  Api: {}
  StoredApi: { readonly url: (query: Query, version: string) => string }
  StoredOnly: { readonly url: (query: Query, version: string) => string }
}>

export const Policy = Data.taggedEnum<Policy>()

export interface AssetEntry {
  readonly indicator: IndicatorId
  readonly series: Stream.Stream<Stored, SourceUnavailable>
}

export interface Bulk {
  // May select any subset of units without narrowing the searchable catalog.
  readonly changed: (
    entries: ReadonlyArray<CatalogEntry>,
  ) => Effect.Effect<Versions, SourceUnavailable>
  // Entries strictly increase by indicator; each inner stream is consumed
  // before pulling the next entry. Series strictly increase by codesOf.
  // Producers must stream, or sort on disk outside Workers, never buffer an asset.
  readonly gather: (
    asset: AssetId,
    options: { readonly version: string; readonly entries: ReadonlyArray<CatalogEntry> },
  ) => Stream.Stream<AssetEntry, SourceUnavailable>
}

// No capability means metadata is unavailable. Null fields in an outline mean
// unknown, false annual or an empty countries array mean confirmed exclusion.
export interface Discovery {
  readonly outlines: Stream.Stream<Outline, SourceUnavailable>
  readonly codelists?: {
    readonly perStep: number
    readonly steps: number
    readonly labels: (
      key: Codelist,
    ) => Effect.Effect<ReadonlyMap<string, string>, SourceUnavailable>
  }
}

// One source, as the catalog, the gather and charts use it.
export interface Adapter {
  readonly discovery?: Discovery

  readonly policy: Policy
  readonly bulk?: Bulk
  // Every catalog entry the source publishes: a World Bank indicator, a
  // Eurostat dataset or an OECD dataflow.
  readonly list: Effect.Effect<ReadonlyArray<CatalogEntry>, SourceUnavailable>
  // An entry's name and definition, and the dataset a chart credits.
  readonly describe: (
    indicator: IndicatorId,
  ) => Effect.Effect<Described, IndicatorNotFound | SourceUnavailable>
  // One series' values for some countries and years, from the source's API.
  readonly fetch: (
    query: Query,
  ) => Effect.Effect<Answer, IndicatorNotFound | SourceUnavailable | DimensionsMissing>
}
