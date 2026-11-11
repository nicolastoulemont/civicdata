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

export const Versions = Schema.Array(
  Schema.Struct({ indicator: IndicatorId, version: Schema.String }),
)

export type Versions = typeof Versions.Type

// What we keep of a source's data.
export type Policy = Data.TaggedEnum<{
  // The gather stores the series of every catalog entry the source lists,
  // and charts read them; a series not stored yet is asked of the source.
  Full: {
    // The current version of each requested catalog entry, in one source request.
    readonly changed: (
      entries: ReadonlyArray<CatalogEntry>,
    ) => Effect.Effect<Versions, SourceUnavailable>
    // The series of one catalog entry, in bulk, as candidates for the store,
    // dated with `release`: sorted by their dimensions' codes (`codesOf`),
    // each once, so the store packs them as they arrive and never holds the
    // entry. A series left out keeps its stored values.
    readonly gather: (
      entry: CatalogEntry,
      release: string,
    ) => Stream.Stream<Stored, SourceUnavailable>
    // The API request that answers the query with the values a stored series
    // holds, which a chart read from the store links.
    readonly url: (query: Query) => string
  }
  // Nothing is stored: every chart asks the source.
  None: {}
}>

export const Policy = Data.taggedEnum<Policy>()

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
