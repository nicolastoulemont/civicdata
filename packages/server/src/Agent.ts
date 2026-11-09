import {
  AgentUnavailable,
  Answered,
  Asked,
  CatalogUnavailable,
  Described,
  IndicatorId,
  Located,
  locate,
  Ranking,
  Rejected as RejectedStep,
  type ResolvedView,
  Searched,
  SourceUnavailable,
  type Step,
  Transform,
  Trend,
  Unanswered,
  View,
} from "@civicdata/domain"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import {
  type Cause,
  Context,
  DateTime,
  Effect,
  Layer,
  Match,
  Option,
  Queue,
  Redacted,
  Ref,
  Schema,
  type SchemaIssue,
  Stream,
  Struct,
} from "effect"
import { Chat, LanguageModel, Prompt, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"

import { Catalog } from "./Catalog.ts"
import { Resolver } from "./Resolver.ts"
import { WorldBank } from "./WorldBank.ts"

// Why an answer could not be given at all.
type Failure = AgentUnavailable | SourceUnavailable | CatalogUnavailable

interface Interface {
  // A new chat that knows how to answer, with no questions yet.
  readonly start: Effect.Effect<Chat.Chat>
  // Answers a question asked in the chat, streaming what the agent does. The
  // stream ends with Answered or Unanswered, and the chat then holds the
  // question and the answer, so a follow-up can build on them.
  readonly ask: (chat: Chat.Chat, question: string) => Stream.Stream<Step, Failure>
}

// Used when the deployment does not name a model in OPENAI_MODEL.
export const defaultModel = "gpt-6.1-terra"

// Model turns before the agent gives up on a question. Each turn is one model
// request, so this also caps what one question can cost.
const rounds = 6

// Earlier questions the model is sent again with a new one. Older questions,
// with everything the agent did to answer them, leave the chat, so a long
// conversation costs no more per question than a short one.
const recall = 3

// The chat's instructions and its last `recall` questions. Each question
// starts with the person's message, so the cut never splits a tool call from
// its result.
const forget = (prompt: Prompt.Prompt) => {
  const questions = prompt.content.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  )

  const first = questions.at(-recall)

  return first === undefined
    ? prompt
    : Prompt.fromMessages([
        ...prompt.content.filter((message) => message.role === "system"),
        ...prompt.content.slice(first),
      ])
}

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
// describe_indicator also answers Rejected for a code that does not exist.
const Shown = Schema.TaggedStruct("Shown", { view: View })
const Rejected = Schema.TaggedStruct("Rejected", { problem: Schema.String })

const Definition = Schema.TaggedStruct("Definition", {
  indicator: IndicatorId,
  name: Schema.String,
  definition: Schema.String,
  dataset: Schema.String,
})

const DescribeIndicator = Tool.make("describe_indicator", {
  description:
    "Read an indicator's full World Bank definition, to tell close indicators apart, e.g. GDP in current dollars from GDP adjusted for inflation.",
  parameters: Schema.Struct({
    indicator: Schema.String.annotate({
      description: "An indicator code returned by search_indicators",
    }),
  }),
  success: Schema.Union([Definition, Rejected]),
  failure: SourceUnavailable,
})

const FindCountries = Tool.make("find_countries", {
  description:
    "Look up the World Bank codes of countries by name, e.g. 'Ivory Coast' or 'South Korea'. Returns the matches for each name, best first; several matches mean the name is ambiguous, none that the World Bank has no data for it.",
  parameters: Schema.Struct({
    names: Schema.Array(Schema.String).annotate({
      description: "Place names as the question writes them",
    }),
  }),
  success: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      matches: Schema.Array(Schema.Struct({ code: Schema.String, name: Schema.String })),
    }),
  ),
})

const AskUser = Tool.make("ask_user", {
  description:
    "Ask the person which of a few readings of their question they mean, when the readings give different charts and none is a safe default. Their reply is the next message. Ask at most once per question.",
  parameters: Schema.Struct({
    question: Schema.String.annotate({ description: "A short question, e.g. 'Which GDP?'" }),
    choices: Schema.Array(Schema.String).annotate({
      description: "Two to four short answers, e.g. 'In current dollars', 'Adjusted for inflation'",
    }),
  }),
  success: Schema.String,
})

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

const Tools = Toolkit.make(SearchIndicators, DescribeIndicator, FindCountries, ShowChart, AskUser)

// A chat leaves tool arguments undecoded; they are checked again to report
// what the agent did.
const isSearch = Schema.is(SearchIndicators.parametersSchema)
const isDescribe = Schema.is(DescribeIndicator.parametersSchema)
const isFind = Schema.is(FindCountries.parametersSchema)
const isAsk = Schema.is(AskUser.parametersSchema)

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

// A trend ends at the latest year it has values for. Told only the current
// year, the model asks for years the World Bank has not published yet.
const trim = ({ view, observations }: ResolvedView): View =>
  Match.valueTags(view, {
    Trend: (trend) =>
      Trend.make({
        ...trend,
        to: observations.reduce((latest, { year }) => (year > latest ? year : latest), trend.from),
      }),
    Ranking: (ranking) => ranking,
  })

const ToolsLayer = Tools.toLayer(
  Effect.gen(function* () {
    const catalog = yield* Catalog
    const resolver = yield* Resolver
    const worldBank = yield* WorldBank

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
      describe_indicator: ({ indicator }) =>
        Schema.decodeEffect(IndicatorId)(indicator).pipe(
          Effect.flatMap(worldBank.describe),
          Effect.map((described) =>
            Definition.make({
              indicator: described.indicator.id,
              name: described.indicator.name,
              definition: described.indicator.definition,
              dataset: described.dataset,
            }),
          ),
          Effect.catchTags({
            SchemaError: () => Effect.succeed(rejected(`${indicator} is not an indicator code.`)),
            IndicatorNotFound: () =>
              Effect.succeed(rejected(`There is no indicator ${indicator}. Search for one.`)),
          }),
        ),
      find_countries: ({ names }) =>
        Effect.succeed(
          names.map((name) => ({
            name,
            matches: locate(name).map((country) => ({ code: country.code, name: country.name })),
          })),
        ),
      // The question is shown when the round ends; see `stepsOf`.
      ask_user: () =>
        Effect.succeed("The question is shown to the person. Their reply is the next message."),
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
                    : Shown.make({ view: trim(resolved) }),
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

// A chat leaves tool arguments undecoded ("opaque"); results are decoded.
type Round = LanguageModel.GenerateTextResponse<Toolkit.Tools<typeof Tools>, "opaque">

const isIndicator = Schema.is(IndicatorId)

// What one tool call tells the person while the agent works.
const stepOf = (call: Round["toolCalls"][number]): ReadonlyArray<Step> => {
  if (call.name === "search_indicators" && isSearch(call.params)) {
    return [Searched.make({ text: call.params.text })]
  }

  if (call.name === "describe_indicator" && isDescribe(call.params)) {
    return isIndicator(call.params.indicator)
      ? [Described.make({ indicator: call.params.indicator })]
      : []
  }

  if (call.name === "find_countries" && isFind(call.params)) {
    return [Located.make({ names: call.params.names })]
  }

  return []
}

// The question the agent asked the person in this round, if any.
const askedIn = (round: Round) =>
  Option.fromUndefinedOr(
    round.toolCalls.flatMap((call) => {
      if (call.name !== "ask_user" || !isAsk(call.params)) return []

      const [first, ...rest] = call.params.choices

      return first === undefined
        ? []
        : [Asked.make({ question: call.params.question, choices: [first, ...rest] })]
    })[0],
  )

// What one round did, in order, and how it ended the answer, if it did: with
// the chart it showed or, failing that, the question it asked.
const stepsOf = (round: Round) => {
  const charts = round.toolResults.flatMap((result) =>
    result.name === "show_chart" && !result.isFailure ? [result.result] : [],
  )

  const rejections = charts.flatMap((chart) =>
    Match.valueTags(chart, {
      Shown: () => [],
      Rejected: ({ problem }) => [RejectedStep.make({ problem })],
    }),
  )

  const shown = charts.flatMap((chart) =>
    Match.valueTags(chart, { Shown: ({ view }) => [Answered.make({ view })], Rejected: () => [] }),
  )

  return {
    steps: [...round.toolCalls.flatMap(stepOf), ...rejections],
    ending: Option.orElse(Option.fromUndefinedOr(shown[0]), () => askedIn(round)),
  }
}

const instructions = (
  year: number,
) => `You turn a question about countries into one chart of World Bank data.

1. Call search_indicators to find the indicator that measures what the question asks. Use only codes it returns; never write a code from memory. When two results are close, call describe_indicator to read their definitions.
2. Call show_chart with that indicator, the countries and the years.
   - When a place name is not plainly one country, call find_countries. List the members of a group yourself, e.g. the G7 or the Nordic countries.
   - Use "trend" when the question is about change over time, and "ranking" when it compares countries at one point.
   - Without years in the question, a trend covers the last 20 years and a ranking the latest year with data. It is ${year} now; most indicators have values up to ${year - 2}.
   - Use a transform only when the question asks for one.
3. If show_chart rejects the chart, fix what it names and call it again.

If no World Bank indicator measures what the question asks, stop without calling show_chart.

If the question can be read in ways that give different charts and none is a safe default, call ask_user instead of show_chart, with two to four short choices. Prefer a sensible default to asking: ask at most once per question.

A later question can follow up on the last chart, e.g. "add Chile" or "now per person". Change what it asks for and keep the rest of that chart.`

export class Agent extends Context.Service<Agent, Interface>()("@civicdata/server/Agent") {
  // Needs a LanguageModel, a Catalog, a Resolver and a WorldBank.
  static readonly layer = Layer.effect(
    Agent,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      const toolkit = yield* Tools

      const start = Effect.gen(function* () {
        const now = yield* DateTime.now

        return yield* Chat.fromPrompt([
          { role: "system", content: instructions(DateTime.getPartUtc(now, "year")) },
        ])
      })

      // Each round is one model request and the tools it calls. Steps are
      // reported once their round is done.
      const answer = Effect.fn("Agent.answer")(
        function* (
          chat: Chat.Chat,
          { question, queue }: { question: string; queue: Queue.Queue<Step, Failure | Cause.Done> },
        ) {
          yield* Ref.update(chat.history, forget)

          for (let round = 0; round < rounds; round += 1) {
            const response = yield* chat.generateText({
              prompt: round === 0 ? question : [],
              toolkit,
            })

            const { steps, ending } = stepsOf(response)

            Queue.offerAllUnsafe(queue, steps)

            if (Option.isSome(ending)) {
              Queue.offerUnsafe(queue, ending.value)

              return
            }

            // No tool call means the model answered in words: it found no chart.
            if (response.toolCalls.length === 0) break
          }

          Queue.offerUnsafe(queue, Unanswered.make({}))
        },
        Effect.provideService(LanguageModel.LanguageModel, model),
        Effect.catchTag("AiError", (error) =>
          Effect.logWarning("Language model failed", error.reason).pipe(
            Effect.andThen(Effect.fail(new AgentUnavailable())),
          ),
        ),
      )

      const ask = (chat: Chat.Chat, question: string) =>
        Stream.callback<Step, Failure>((queue) =>
          answer(chat, { question, queue }).pipe(Effect.andThen(Queue.end(queue))),
        )

      return Agent.of({ start, ask })
    }),
  ).pipe(Layer.provide(ToolsLayer))

  static readonly unavailable = Layer.succeed(
    Agent,
    Agent.of({ start: Chat.empty, ask: () => Stream.fail(new AgentUnavailable()) }),
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
