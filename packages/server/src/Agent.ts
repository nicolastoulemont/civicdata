import {
  AgentUnavailable,
  CatalogUnavailable,
  IndicatorId,
  NoChart,
  Ranking,
  SourceUnavailable,
  Transform,
  Trend,
  View,
} from "@civicdata/domain"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import {
  Context,
  DateTime,
  Effect,
  Layer,
  Match,
  Redacted,
  Schema,
  type SchemaIssue,
  Struct,
} from "effect"
import { Chat, LanguageModel, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"

import { Catalog } from "./Catalog.ts"
import { Resolver } from "./Resolver.ts"

interface Interface {
  readonly ask: (
    question: string,
  ) => Effect.Effect<View, NoChart | AgentUnavailable | SourceUnavailable | CatalogUnavailable>
}

// Used when the deployment does not name a model in OPENAI_MODEL.
const defaultModel = "gpt-6.1-terra"

// Model turns before the agent gives up on a question. Each turn is one model
// request, so this also caps what one question can cost.
const rounds = 6

const SearchIndicators = Tool.make("search_indicators", {
  description:
    "Search World Bank indicators by words in their name or definition, or by code. Returns up to 10 matches, best first.",
  parameters: Schema.Struct({
    text: Schema.String.annotate({
      description: "Words to search for, e.g. 'life expectancy' or 'GDP per capita'",
    }),
  }),
  success: Schema.Array(
    Schema.Struct({ indicator: IndicatorId, name: Schema.String, definition: Schema.String }),
  ),
  failure: Schema.Union([SourceUnavailable, CatalogUnavailable]),
})

// What show_chart tells the model: the chart was shown, or why it was not.
const Shown = Schema.TaggedStruct("Shown", { view: View })
const Rejected = Schema.TaggedStruct("Rejected", { problem: Schema.String })

const ShowChart = Tool.make("show_chart", {
  description:
    "Show one chart of a World Bank indicator. The chart is checked against the data; when it is rejected, fix what the problem names and call again.",
  parameters: Schema.Struct({
    chart: Schema.Literals(["trend", "ranking"]).annotate({
      description:
        "trend: one line per country over a range of years. ranking: countries compared in one year.",
    }),
    indicator: Schema.String.annotate({
      description: "An indicator code returned by search_indicators, e.g. SP.DYN.LE00.IN",
    }),
    countries: Schema.Array(Schema.String).annotate({
      description:
        "ISO 3166-1 alpha-3 codes of single economies, e.g. FRA, BRA. No regions or groups.",
    }),
    from: Schema.NullOr(Schema.Int).annotate({
      description: "First year of a trend; null for a ranking",
    }),
    to: Schema.NullOr(Schema.Int).annotate({
      description: "Last year of a trend; null for a ranking",
    }),
    year: Schema.NullOr(Schema.Int).annotate({
      description: "The year of a ranking; null for a trend",
    }),
    transform: Schema.NullOr(Transform).annotate({
      description:
        "PerPerson divides a total by population. Growth is the annual % change. Index sets a trend's first year to 100. null shows values as published.",
    }),
  }),
  success: Schema.Union([Shown, Rejected]),
  failure: SourceUnavailable,
})

const Tools = Toolkit.make(SearchIndicators, ShowChart)

type Draft = typeof ShowChart.parametersSchema.Type

// A View's fields without its tag: what the model's arguments decode to.
const TrendFields = Trend.mapFields(Struct.omit(["_tag"]))
const RankingFields = Ranking.mapFields(Struct.omit(["_tag"]))

// makeEffect reports a failed check as a bare Issue.
const checked = <A>(made: Effect.Effect<A, SchemaIssue.Issue>) =>
  Effect.mapError(made, (issue) => new Schema.SchemaError(issue))

// The View the model described. Decodes the fields the chart type takes, then
// builds the View, which checks that the years run forwards.
const toView = (draft: Draft): Effect.Effect<View, Schema.SchemaError> => {
  const fields: Record<string, Draft[keyof Draft]> =
    draft.chart === "trend"
      ? { indicator: draft.indicator, countries: draft.countries, from: draft.from, to: draft.to }
      : { indicator: draft.indicator, countries: draft.countries, year: draft.year }

  if (draft.transform !== null) fields["transform"] = draft.transform

  return draft.chart === "trend"
    ? Schema.decodeUnknownEffect(TrendFields)(fields).pipe(
        Effect.flatMap((trend) => checked(Trend.makeEffect(trend))),
      )
    : Schema.decodeUnknownEffect(RankingFields)(fields).pipe(
        Effect.flatMap((ranking) => checked(Ranking.makeEffect(ranking))),
      )
}

const rejected = (problem: string) => Rejected.make({ problem })

const ToolsLayer = Tools.toLayer(
  Effect.gen(function* () {
    const catalog = yield* Catalog
    const resolver = yield* Resolver

    return Tools.of({
      search_indicators: ({ text }) =>
        catalog.search(text).pipe(
          Effect.map((entries) =>
            entries.slice(0, 10).map(({ indicator, name, definition }) => ({
              indicator,
              name,
              definition: definition.slice(0, 300),
            })),
          ),
        ),
      // Accepts only a View that decodes and resolves to at least one value.
      // Mistakes go back to the model to fix; an unreachable World Bank fails
      // the question.
      show_chart: (draft) =>
        toView(draft).pipe(
          Effect.flatMap((view) =>
            resolver
              .resolve(view)
              .pipe(
                Effect.map((resolved) =>
                  resolved.observations.length === 0
                    ? rejected(
                        "The World Bank has no values for these countries and years. Try other years.",
                      )
                    : Shown.make({ view }),
                ),
              ),
          ),
          Effect.catchTags({
            SchemaError: (error) => Effect.succeed(rejected(error.message)),
            IndicatorNotFound: ({ indicator }) =>
              Effect.succeed(rejected(`There is no indicator ${indicator}. Search for one.`)),
            TransformNotApplicable: ({ indicator, transform }) =>
              Effect.succeed(
                rejected(
                  `${indicator} is a percentage or rate; ${transform} does not apply to it.`,
                ),
              ),
          }),
        ),
    })
  }),
)

const instructions = (
  year: number,
) => `You turn a question about countries into one chart of World Bank data.

1. Call search_indicators to find the indicator that measures what the question asks. Use only codes it returns; never write a code from memory.
2. Call show_chart with that indicator, the countries and the years.
   - Use "trend" when the question is about change over time, and "ranking" when it compares countries at one point.
   - Without years in the question, a trend covers the last 20 years and a ranking the latest year with data. It is ${year} now; most indicators have values up to ${year - 2}.
   - Use a transform only when the question asks for one.
3. If show_chart rejects the chart, fix what it names and call it again.

If no World Bank indicator measures what the question asks, stop without calling show_chart.`

export class Agent extends Context.Service<Agent, Interface>()("@civicdata/server/Agent") {
  // Needs a LanguageModel, a Catalog and a Resolver.
  static readonly layer = Layer.effect(
    Agent,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      const toolkit = yield* Tools

      const ask = Effect.fn("Agent.ask")(
        function* (question: string) {
          const now = yield* DateTime.now

          const chat = yield* Chat.fromPrompt([
            { role: "system", content: instructions(DateTime.getPartUtc(now, "year")) },
            { role: "user", content: question },
          ])

          for (let round = 0; round < rounds; round += 1) {
            const response = yield* chat.generateText({ prompt: [], toolkit })

            const shown = response.toolResults.flatMap((result) =>
              result.name === "show_chart" && !result.isFailure
                ? Match.valueTags(result.result, {
                    Shown: ({ view }) => [view],
                    Rejected: () => [],
                  })
                : [],
            )

            if (shown[0] !== undefined) return shown[0]

            // No tool call means the model answered in words: it found no chart.
            if (response.toolCalls.length === 0) break
          }

          return yield* new NoChart()
        },
        Effect.provideService(LanguageModel.LanguageModel, model),
        Effect.catchTag("AiError", (error) =>
          Effect.logWarning("Language model failed", error.reason).pipe(
            Effect.andThen(Effect.fail(new AgentUnavailable())),
          ),
        ),
      )

      return Agent.of({ ask })
    }),
  ).pipe(Layer.provide(ToolsLayer))

  static readonly unavailable = Layer.succeed(
    Agent,
    Agent.of({ ask: () => Effect.fail(new AgentUnavailable()) }),
  )

  // OpenAI, when the deployment has an OPENAI_API_KEY binding. Without one
  // (plain `pnpm dev`, or a stage nobody gave a key) every question fails with
  // AgentUnavailable.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.OPENAI_API_KEY === undefined
          ? Agent.unavailable
          : Agent.layer.pipe(
              Layer.provide(OpenAiLanguageModel.model(env.OPENAI_MODEL ?? defaultModel)),
              Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(env.OPENAI_API_KEY) })),
              Layer.provide(FetchHttpClient.layer),
            ),
      ),
      Effect.orElseSucceed(() => Agent.unavailable),
    ),
  )
}
