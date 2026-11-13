import { Finding, studiesOf } from "@repo/domain"
import { Effect, Schema } from "effect"

import { fingerprint } from "../../src/fingerprint.ts"
import { Seed } from "../../src/research/archive.ts"
import findings from "../../src/research/findings.json" with { type: "json" }

export const seeds = Effect.gen(function* () {
  const all = yield* Schema.decodeUnknownEffect(Schema.Array(Finding))(findings)

  const collected = all.flatMap(({ evidence }) => studiesOf(evidence))

  return yield* Effect.forEach(
    [...new Map(collected.map((study) => [study.url, study])).values()],
    (study) =>
      fingerprint(study.url).pipe(Effect.map((id) => Seed.make({ id, study, openalex: null }))),
  )
})
