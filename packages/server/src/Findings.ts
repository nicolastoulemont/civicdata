import { type Country, covers, Finding, type IndicatorId, type Year } from "@civicdata/domain"
import { Context, Effect, Layer, Schema } from "effect"

import findings from "./research/findings.json"

interface Query {
  readonly indicator: IndicatorId
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}

interface Interface {
  // The findings that explain the indicator in any of the countries during
  // any of the years, in the catalogue's order.
  readonly covering: (query: Query) => Effect.Effect<ReadonlyArray<Finding>>
}

// The catalogue: each finding once.
const Catalogue = Schema.Array(Finding).check(
  Schema.makeFilter(
    (all) => new Set(all.map(({ id }) => id)).size === all.length || "each finding has its own id",
  ),
)

const over = (all: ReadonlyArray<Finding>): Interface => ({
  covering: ({ indicator, countries, from, to }) =>
    Effect.succeed(
      all.filter(
        (finding) =>
          finding.indicators.includes(indicator) &&
          countries.some((country) => covers(finding.scope, country)) &&
          finding.from <= to &&
          finding.to >= from,
      ),
    ),
})

// The research findings the agent may cite for why a figure moved, reviewed
// by hand and shipped with the code (see research/README.md).
export class Findings extends Context.Service<Findings, Interface>()("@civicdata/server/Findings") {
  static readonly layer = Layer.effect(
    Findings,
    Schema.decodeUnknownEffect(Catalogue)(findings).pipe(
      Effect.map((all) => Findings.of(over(all))),
      Effect.orDie,
    ),
  )

  // Findings of a test's own.
  static readonly holding = (all: ReadonlyArray<Finding>) =>
    Layer.succeed(Findings, Findings.of(over(all)))
}
