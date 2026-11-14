import { DateTime, Duration, Effect, Schema } from "effect"

import { Cache } from "../platform/Cache.ts"
import type { Adapter } from "../series/Adapter.types.ts"
import { Answer, Described } from "../series/Series.schemas.ts"
import { widen } from "../series/Series.ts"

const fresh = (at: DateTime.Utc, now: DateTime.Utc) =>
  Duration.isLessThan(DateTime.distance(at, now), Duration.days(1))

// Keep publisher prefixes and the deployed serialized query unchanged.
export const cached = Effect.fn("Api.cached")(function* (adapter: Adapter, prefix: string) {
  const remember = yield* Cache.remember

  return {
    ...adapter,
    describe: (id) =>
      remember(`${prefix}/describe/${id}`, {
        json: Schema.fromJsonString(Schema.toCodecJson(Described)),
        fresh,
        fetch: adapter.describe(id),
      }),
    fetch: widen((query) =>
      remember(
        `${prefix}/series/${JSON.stringify({ ...query, dimensions: Object.entries(query.dimensions).toSorted(([left], [right]) => left.localeCompare(right)) })}`,
        {
          json: Schema.fromJsonString(Schema.toCodecJson(Answer)),
          fresh,
          fetch: adapter.fetch(query),
        },
      ),
    ),
  } satisfies Adapter
})
