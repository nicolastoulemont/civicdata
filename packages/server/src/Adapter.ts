import type {
  CatalogEntry,
  DimensionsMissing,
  IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
} from "@civicdata/domain"
import { Data, type Effect, type Option } from "effect"

import type { Answer, Described, Query } from "./Series.ts"
import type { Stored } from "./Store.ts"

// What we keep of a source's data.
export type Policy = Data.TaggedEnum<{
  // The gather stores the series of every catalog entry the source lists,
  // and charts read them; a series not stored yet is asked of the source.
  Full: {
    // The release to gather, or none when `gathered`, the release the last
    // complete gather recorded, is still the source's latest.
    readonly changed: (
      gathered: Option.Option<string>,
    ) => Effect.Effect<Option.Option<string>, SourceUnavailable>
    // Every series of one catalog entry, in bulk, as candidates for the
    // store, dated with `release`.
    readonly gather: (
      entry: CatalogEntry,
      release: string,
    ) => Effect.Effect<ReadonlyArray<Stored>, SourceUnavailable>
    // The API request that answers the query with the values a stored series
    // holds, which a chart read from the store links.
    readonly url: (query: Query) => string
  }
  // Nothing is stored: every chart asks the source.
  None: {}
}>

export const Policy = Data.taggedEnum<Policy>()

// One source, as the catalog, the gather and the charts use it. Each source
// implements it once; the Sources registry picks one by `sourceOf`.
export interface Adapter {
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
