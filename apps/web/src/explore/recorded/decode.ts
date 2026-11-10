import { ResolvedView } from "@civicdata/domain"
import { Schema } from "effect"

// The JSON files here are World Bank responses recorded on 2026-11-10 in the
// shape the resolve endpoint returns, for the chart stories. Each lists its
// series' URLs and retrieval time under `sources`; fetch a URL again to
// refresh its values. This reads one as the API client reads a response.
export const decode = Schema.decodeUnknownSync(Schema.toCodecJson(ResolvedView))
