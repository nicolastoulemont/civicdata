import {
  AgentUnavailable,
  Answered,
  Asked,
  CatalogUnavailable,
  Change,
  Checked,
  Definition,
  type Dimension,
  type DimensionsMissing,
  Dropped,
  Failed,
  Fetch,
  Fetched,
  IndicatorId,
  type IndicatorNotFound,
  kindOf,
  Located,
  locate,
  Lookup,
  Ranking,
  Ratio,
  Read,
  Rejected,
  Rejection,
  Relation,
  type ResolvedView,
  Running,
  Search,
  Searched,
  Source,
  SourceUnavailable,
  sourceOf,
  type Step,
  StepId,
  Takeaway,
  Thinking,
  Thought,
  type TransformNotApplicable,
  Trend,
  Unanswered,
  View,
  type Work,
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
  Result,
  Schema,
  type SchemaIssue,
  Stream,
  Struct,
} from "effect"
import { Chat, LanguageModel, Prompt, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"

import { Catalog } from "./Catalog.ts"
import { Resolver } from "./Resolver.ts"
import { Sdmx } from "./Sdmx.ts"
import { check, rules, Summary, summarize } from "./Takeaway.ts"
import { WorldBank } from "./WorldBank.ts"

// Why an answer could not be given at all.
type Failure = AgentUnavailable | SourceUnavailable | CatalogUnavailable

// Why a chart could not be explained.
type Unexplained =
  | AgentUnavailable
  | SourceUnavailable
  | IndicatorNotFound
  | TransformNotApplicable
  | DimensionsMissing

interface Interface {
  // A new chat that knows how to answer, with no questions yet.
  readonly start: Effect.Effect<Chat.Chat>
  // Answers a question asked in the chat, streaming what the agent does. The
  // stream ends with Answered or Unanswered, and the chat then holds the
  // question and the answer, so a follow-up can build on them.
  readonly ask: (chat: Chat.Chat, question: string) => Stream.Stream<Step, Failure>
  // A takeaway for a chart on its own, outside a chat, e.g. after someone
  // edited the chart the agent showed. It has none when the model's text
  // fails the check.
  readonly explain: (view: View) => Effect.Effect<typeof Answered.Type, Unexplained>
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

// Where a tool reports its step while it runs: to the answer that called it.
class Report extends Context.Service<Report, (step: Work) => Effect.Effect<void>>()(
  "@civicdata/server/Agent/Report",
) {}

// Why a step failed.
type Reason = typeof Failed.Type.reason

// Runs a tool's work as one step, reported running, then as `done` says from
// its result, or failed with its error. `at` makes the step in a state.
const reported = Effect.fnUntraced(function* <A, E extends Reason, R>(
  work: Effect.Effect<A, E, R>,
  {
    at,
    done,
  }: {
    readonly at: (state: typeof Running.Type | typeof Failed.Type) => Work
    readonly done: (result: A) => Work
  },
) {
  const report = yield* Report

  yield* report(at(Running.make({})))

  const result = yield* work.pipe(Effect.tapError((reason) => report(at(Failed.make({ reason })))))

  yield* report(done(result))

  return result
})

// A tool call's step id. A chat always passes the call's id.
const stepOf = (id: string | undefined, tool: string) => StepId.make(id ?? tool)

const SearchIndicators = Tool.make("search_indicators", {
  description:
    "Search the indicators of the World Bank, Eurostat and the OECD by words in their name or definition, or by code. Returns up to 10 matches, best first, each with its source.",
  parameters: Schema.Struct({
    text: Schema.String.annotate({
      description: "Words to search for, e.g. 'life expectancy' or 'GDP per capita'",
    }),
    source: Schema.NullOr(Source).annotate({
      description: "Only this source's indicators; null for all three",
    }),
  }),
  success: Schema.Array(
    Schema.Struct({
      indicator: IndicatorId,
      source: Source,
      name: Schema.String,
      definition: Schema.String,
    }),
  ),
  failure: Schema.Union([SourceUnavailable, CatalogUnavailable]),
  dependencies: [Report],
})

// What show_chart tells the model: the chart was shown with a summary of its
// values, or why it was not. describe_indicator also answers Rejected for a
// code that does not exist.
const Shown = Schema.TaggedStruct("Shown", { view: View, data: Summary })
const Refused = Schema.TaggedStruct("Rejected", { problem: Schema.String })

const Defined = Schema.TaggedStruct("Definition", {
  indicator: IndicatorId,
  source: Source,
  name: Schema.String,
  definition: Schema.String,
  dataset: Schema.String,
})

const DescribeIndicator = Tool.make("describe_indicator", {
  description:
    "Read an indicator's full definition from its source, to tell close indicators apart, e.g. GDP in current dollars from GDP adjusted for inflation.",
  parameters: Schema.Struct({
    indicator: Schema.String.annotate({
      description: "An indicator code returned by search_indicators",
    }),
  }),
  success: Schema.Union([Defined, Refused]),
  failure: SourceUnavailable,
  dependencies: [Report],
})

const FindCountries = Tool.make("find_countries", {
  description:
    "Look up the ISO 3166-1 alpha-3 codes of countries by name, e.g. 'Ivory Coast' or 'South Korea'. show_chart takes these codes for every source. Returns the matches for each name, best first; several matches mean the name is ambiguous, none that no source has data for it.",
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
  dependencies: [Report],
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
    "Show one chart of a World Bank, Eurostat or OECD indicator. The chart is checked against the data; when it is rejected, fix what the problem names and call again.",
  parameters: Schema.Struct({
    chart: Schema.Literals(["trend", "ranking", "map", "change", "relation"]).annotate({
      description:
        "trend: one line per country over a range of years. ranking: countries compared in one year, as bars. map: a ranking drawn as a world map, for many countries. change: each country's value in two years, from and to. relation: one dot per country in one year, the indicator against another.",
    }),
    indicator: Schema.String.annotate({
      description: "An indicator code returned by search_indicators, e.g. SP.DYN.LE00.IN",
    }),
    against: Schema.NullOr(Schema.String).annotate({
      description:
        "The indicator code a relation plots the indicator against, e.g. NY.GDP.PCAP.CD; null for other charts",
    }),
    countries: Schema.Array(Schema.String).annotate({
      description:
        "ISO 3166-1 alpha-3 codes of single economies, e.g. FRA, BRA. No regions or groups.",
    }),
    from: Schema.NullOr(Schema.Int).annotate({
      description: "First year of a trend or a change; null otherwise",
    }),
    to: Schema.NullOr(Schema.Int).annotate({
      description: "Last year of a trend or a change; null otherwise",
    }),
    year: Schema.NullOr(Schema.Int).annotate({
      description: "The year of a ranking, a map or a relation; null otherwise",
    }),
    transform: Schema.NullOr(Schema.Literals(["PerPerson", "Growth", "Index", "Ratio"])).annotate({
      description:
        "PerPerson divides a total by population. Growth is the annual % change. Index sets a trend's first year to 100. Ratio divides by the indicator in per. A change takes only PerPerson and Ratio, and a relation none. null shows values as published.",
    }),
    per: Schema.NullOr(Schema.String).annotate({
      description: "The indicator code a Ratio divides by, e.g. NY.GDP.MKTP.CD; null otherwise",
    }),
    dimensions: Schema.NullOr(
      Schema.Array(Schema.Struct({ dimension: Schema.String, code: Schema.String })),
    ).annotate({
      description:
        "For a Eurostat or OECD indicator, the code of each dimension its series differ by, e.g. [{ dimension: 'sex', code: 'T' }]. A rejection lists the dimensions and their codes. null for World Bank indicators.",
    }),
  }),
  success: Schema.Union([Shown, Refused]),
  failure: SourceUnavailable,
  dependencies: [Report],
})

const Tools = Toolkit.make(SearchIndicators, DescribeIndicator, FindCountries, ShowChart, AskUser)

// A chat leaves tool arguments undecoded; ask_user's are checked again to
// show its question.
const isAsk = Schema.is(AskUser.parametersSchema)
const isShown = Schema.is(Shown)

type Draft = typeof ShowChart.parametersSchema.Type

// A View's fields without its tag: what the model's arguments decode to.
const TrendFields = Trend.mapFields(Struct.omit(["_tag"]))
const RankingFields = Ranking.mapFields(Struct.omit(["_tag"]))
const ChangeFields = Change.mapFields(Struct.omit(["_tag"]))
const RelationFields = Relation.mapFields(Struct.omit(["_tag"]))
const RatioFields = Ratio.mapFields(Struct.omit(["_tag"]))

// makeEffect reports a failed check as a bare Issue.
const checked = <A>(made: Effect.Effect<A, SchemaIssue.Issue>) =>
  Effect.mapError(made, (issue) => new Schema.SchemaError(issue))

// The View the model described. Decodes the fields the chart type takes, then
// builds the View, which checks it, e.g. that the years run forwards. A
// transform the chart type does not take is an error, not dropped.
const toView = Effect.fnUntraced(function* (draft: Draft) {
  const { indicator, against, countries, from, to, year } = draft

  // A ratio carries the indicator it divides by.
  const transform =
    draft.transform === "Ratio"
      ? Ratio.make(yield* Schema.decodeUnknownEffect(RatioFields)({ per: draft.per }))
      : draft.transform

  const fields: Record<string, Draft[keyof Draft] | Ratio | Readonly<Record<string, string>>> =
    Match.value(draft.chart).pipe(
      Match.whenOr("trend", "change", () => ({ indicator, countries, from, to })),
      Match.when("ranking", () => ({ indicator, countries, year })),
      Match.when("map", () => ({ indicator, countries, year, as: "Map" })),
      Match.when("relation", () => ({ indicator, against, countries, year })),
      Match.exhaustive,
    )

  if (transform !== null) fields["transform"] = transform

  if (draft.dimensions !== null && draft.dimensions.length > 0)
    fields["dimensions"] = Object.fromEntries(
      draft.dimensions.map(({ dimension, code }) => [dimension, code]),
    )

  const decode = <S extends Schema.Top>(schema: S) =>
    Schema.decodeUnknownEffect(schema)(fields, { onExcessProperty: "error" })

  return yield* Match.value(draft.chart).pipe(
    Match.when("trend", () =>
      decode(TrendFields).pipe(Effect.flatMap((made) => checked(Trend.makeEffect(made)))),
    ),
    Match.whenOr("ranking", "map", () =>
      decode(RankingFields).pipe(Effect.flatMap((made) => checked(Ranking.makeEffect(made)))),
    ),
    Match.when("change", () =>
      decode(ChangeFields).pipe(Effect.flatMap((made) => checked(Change.makeEffect(made)))),
    ),
    Match.when("relation", () =>
      decode(RelationFields).pipe(Effect.flatMap((made) => checked(Relation.makeEffect(made)))),
    ),
    Match.exhaustive,
  )
})

const rejected = (problem: string) => Refused.make({ problem })

// The takeaway written for a chart, and how its step ended.
interface Written {
  readonly answered: typeof Answered.Type
  readonly state: typeof Takeaway.Type.state
}

// A chart the data cannot show: why, for people, and what to fix, for the model.
interface Refusal {
  readonly reason: Rejection
  readonly problem: string
}

const refuse = (reason: Rejection, problem: string): Result.Result<ResolvedView, Refusal> =>
  Result.fail({ reason, problem })

// A trend ends at the latest year it has values for. Told only the current
// year, the model asks for years the World Bank has not published yet. A
// change names its two years, so it is kept as asked.
const trim = ({ view, observations }: ResolvedView): View =>
  Match.valueTags(view, {
    Trend: (trend) =>
      Trend.make({
        ...trend,
        to: observations.reduce((latest, { year }) => (year > latest ? year : latest), trend.from),
      }),
    Ranking: (ranking) => ranking,
    Change: (change) => change,
    Relation: (relation) => relation,
  })

// A dimension and its first codes as the model reads them:
// "sex (F Females, M Males, T Total)".
const listed = ({ id, options }: Dimension) =>
  `${id} (${options
    .slice(0, 20)
    .map(({ code, label }) => `${code} ${label}`)
    .join(", ")}${options.length > 20 ? ", …" : ""})`

// Why a chart has no values. Eurostat and OECD charts read annual data
// only, so a quarterly or monthly dataflow has none.
const noValues = (source: Source) =>
  source === "World Bank"
    ? "The World Bank has no values for these countries and years. Try other years."
    : `${source} has no annual values for these countries and years. Try other years, or another dataflow if this one is quarterly or monthly only.`

const ToolsLayer = Tools.toLayer(
  Effect.gen(function* () {
    const catalog = yield* Catalog
    const resolver = yield* Resolver
    const worldBank = yield* WorldBank
    const sdmx = yield* Sdmx

    return Tools.of({
      search_indicators: ({ text, source }, { toolCallId }) => {
        const id = stepOf(toolCallId, "search_indicators")

        const at = (state: typeof Search.Type.state) =>
          source === null
            ? Search.make({ id, text, state })
            : Search.make({ id, text, source, state })

        return reported(catalog.search(text, { source: source ?? undefined }), {
          at,
          done: (entries) =>
            at(
              Searched.make({
                count: entries.length,
                top: entries.slice(0, 5).map(({ indicator, name }) => ({ indicator, name })),
              }),
            ),
        }).pipe(
          Effect.map((entries) =>
            entries.slice(0, 10).map(({ indicator, name, definition }) => ({
              indicator,
              source: sourceOf(indicator),
              name,
              definition: definition.slice(0, 300),
            })),
          ),
        )
      },
      // A code that is not an indicator's is the model's mistake, told to it
      // alone; one that names no indicator fails the step.
      describe_indicator: ({ indicator }, { toolCallId }) =>
        Schema.decodeEffect(IndicatorId)(indicator).pipe(
          Effect.flatMap((id) => {
            const at = (state: typeof Definition.Type.state) =>
              Definition.make({
                id: stepOf(toolCallId, "describe_indicator"),
                indicator: id,
                state,
              })

            return reported(
              sourceOf(id) === "World Bank" ? worldBank.describe(id) : sdmx.describe(id),
              { at, done: (described) => at(Read.make({ name: described.indicator.name })) },
            )
          }),
          Effect.map((described) =>
            Defined.make({
              indicator: described.indicator.id,
              source: sourceOf(described.indicator.id),
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
      find_countries: ({ names }, { toolCallId }) => {
        const at = (state: typeof Lookup.Type.state) =>
          Lookup.make({ id: stepOf(toolCallId, "find_countries"), names, state })

        const places = names.map((name) => ({ name, countries: locate(name) }))

        return reported(Effect.succeed(places), {
          at,
          done: (found) =>
            at(
              Located.make({
                places: found.map(({ name, countries }) => ({
                  name,
                  countries: countries.map(({ code }) => code),
                })),
              }),
            ),
        }).pipe(
          Effect.map((found) =>
            found.map(({ name, countries }) => ({
              name,
              matches: countries.map((country) => ({ code: country.code, name: country.name })),
            })),
          ),
        )
      },
      // The question is shown when the round ends; see `endingOf`.
      ask_user: () =>
        Effect.succeed("The question is shown to the person. Their reply is the next message."),
      // Accepts only a View that decodes and resolves to at least one value.
      // Mistakes go back to the model to fix; an unreachable source fails
      // the question. A View that does not decode is the model's mistake,
      // told to it alone; one the data cannot show is reported with why.
      show_chart: (draft, { toolCallId }) =>
        toView(draft).pipe(
          Effect.flatMap((view) => {
            const at = (state: typeof Fetch.Type.state) =>
              Fetch.make({ id: stepOf(toolCallId, "show_chart"), view, state })

            const fetched: Effect.Effect<
              Result.Result<ResolvedView, Refusal>,
              SourceUnavailable
            > = resolver.resolve(view).pipe(
              Effect.map((resolved) =>
                resolved.observations.length === 0
                  ? refuse(Rejection.cases.NoValues.make({}), noValues(sourceOf(view.indicator)))
                  : Result.succeed(resolved),
              ),
              Effect.catchTags({
                IndicatorNotFound: ({ indicator }) =>
                  Effect.succeed(
                    refuse(
                      Rejection.cases.NoIndicator.make({ indicator }),
                      `There is no indicator ${indicator}. Search for one.`,
                    ),
                  ),
                TransformNotApplicable: ({ indicator, transform }) =>
                  Effect.succeed(
                    refuse(
                      Rejection.cases.NotApplicable.make({}),
                      `${indicator} is a percentage or rate; ${kindOf(transform)} does not apply to it.`,
                    ),
                  ),
                DimensionsMissing: ({ indicator, dimensions, open }) =>
                  Effect.succeed(
                    refuse(
                      Rejection.cases.OpenDimensions.make({ open }),
                      `${indicator} holds several series. Pass one code for each of these dimensions: ${dimensions
                        .filter((dimension) => open.includes(dimension.id))
                        .map(listed)
                        .join("; ")}.`,
                    ),
                  ),
              }),
            )

            return reported(fetched, {
              at,
              done: Result.match({
                onSuccess: ({ observations }) => at(Fetched.make({ values: observations.length })),
                onFailure: ({ reason }) => at(Rejected.make({ reason })),
              }),
            }).pipe(
              Effect.map(
                Result.match({
                  onSuccess: (resolved) =>
                    Shown.make({ view: trim(resolved), data: summarize(resolved) }),
                  onFailure: ({ problem }) => rejected(problem),
                }),
              ),
            )
          }),
          Effect.catchTag("SchemaError", (error) => Effect.succeed(rejected(error.message))),
        ),
    })
  }),
)

// A chat leaves tool arguments undecoded ("opaque"); results are decoded.
type Round = LanguageModel.GenerateTextResponse<Toolkit.Tools<typeof Tools>, "opaque">

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

// How one round ended the answer, if it did: with the chart it showed or,
// failing that, the question it asked.
const endingOf = (round: Round) => {
  const shown = round.toolResults.flatMap((result) =>
    result.name === "show_chart" && !result.isFailure && isShown(result.result)
      ? [result.result]
      : [],
  )

  return Option.orElse(Option.fromUndefinedOr(shown[0]), () => askedIn(round))
}

const instructions = (
  year: number,
) => `You turn a question about countries into one chart of data from the World Bank, Eurostat or the OECD.

Pick the source that fits the question when several measure the same thing:
- Eurostat when every country in the question is in the European Union.
- The OECD when every country is an OECD member and some are outside the European Union.
- The World Bank for worldwide comparisons, and whenever the source above has no indicator for what the question asks.
- The source the question names, if it names one.
A measure only one source publishes comes from that source.

1. Call search_indicators to find the indicator that measures what the question asks. Use only codes it returns; never write a code from memory. Pass a source to look in that source only, e.g. when its first results are another source's. When two results are close, call describe_indicator to read their definitions.
2. Call show_chart with that indicator, the countries and the years.
   - Countries are ISO 3166-1 alpha-3 codes for every source. When a place name is not plainly one country, call find_countries. List the members of a group yourself, e.g. the G7 or the Nordic countries.
   - Use "trend" when the question is about change over time, and "ranking" when it compares countries at one point. Use "change" when it compares two years, and "relation" when it asks how one indicator goes with another; search for that second indicator too.
   - Without years in the question, a trend covers the last 20 years and a ranking the latest year with data. It is ${year} now; most indicators have values up to ${year - 2}.
   - Charts show annual values. Prefer a Eurostat or OECD dataflow whose name does not say quarterly or monthly.
   - A Eurostat or OECD dataflow holds several series, e.g. by sex or age. show_chart's rejection lists its dimensions and their codes: pick the series the question asks for, else the total.
   - Use a transform only when the question asks for one.
3. If show_chart rejects the chart, fix what it names and call it again.
4. Once show_chart shows the chart, write its takeaway from the data show_chart returns: ${rules} When you picked one source over others that measure the same thing, name it, e.g. "Eurostat's figures show".

If no indicator of any source measures what the question asks, stop without calling show_chart.

If the question can be read in ways that give different charts and none is a safe default, call ask_user instead of show_chart, with two to four short choices. Prefer a sensible default to asking: ask at most once per question.

A later question can follow up on the last chart, e.g. "add Chile" or "now per person". Change what it asks for and keep the rest of that chart.`

export class Agent extends Context.Service<Agent, Interface>()("@civicdata/server/Agent") {
  // Needs a LanguageModel, a Catalog, a Resolver, a WorldBank and an Sdmx.
  static readonly layer = Layer.effect(
    Agent,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      const toolkit = yield* Tools
      const resolver = yield* Resolver

      const start = Effect.gen(function* () {
        const now = yield* DateTime.now

        return yield* Chat.fromPrompt([
          { role: "system", content: instructions(DateTime.getPartUtc(now, "year")) },
        ])
      })

      // The chart's takeaway, written by the model from the data show_chart
      // returned, and how its step ended. A model that fails or writes one
      // that fails the check leaves the chart without one.
      const takeaway = Effect.fn("Agent.takeaway")(
        function* (chat: Chat.Chat, { view, data }: typeof Shown.Type) {
          const response = yield* chat.generateText({ prompt: [], toolkit, toolChoice: "none" })

          return Option.match(check(response.text, data), {
            onNone: (): Written => ({
              answered: Answered.make({ view }),
              state: Dropped.make({}),
            }),
            onSome: ({ text, numbers }): Written => ({
              answered: Answered.make({ view, takeaway: text }),
              state: Checked.make({ numbers }),
            }),
          })
        },
        Effect.provideService(LanguageModel.LanguageModel, model),
        (effect, _chat, { view }) =>
          Effect.catchTag(effect, "AiError", (error) =>
            Effect.logWarning("Language model failed on a takeaway", error.reason).pipe(
              Effect.as<Written>({
                answered: Answered.make({ view }),
                state: Failed.make({ reason: new AgentUnavailable() }),
              }),
            ),
          ),
      )

      // Each round is one model request and the tools it calls. The round's
      // Thinking step runs while the model decides, and ends when a tool
      // reports its step or the model answers. Each tool reports its step as
      // it starts and as it ends.
      const answer = Effect.fn("Agent.answer")(function* (
        chat: Chat.Chat,
        { question, queue }: { question: string; queue: Queue.Queue<Step, Failure | Cause.Done> },
      ) {
        const send = (step: Step) => Effect.sync(() => Queue.offerUnsafe(queue, step))

        const thinking = yield* Ref.make(Option.none<StepId>())

        // Ends the Thinking step, if one runs, in `state`.
        const think = (state: typeof Thinking.Type.state) =>
          Ref.getAndSet(thinking, Option.none()).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (id) => send(Thinking.make({ id, state })),
              }),
            ),
          )

        const report = Report.of((step) => think(Thought.make({})).pipe(Effect.andThen(send(step))))

        const decided = Effect.gen(function* () {
          yield* Ref.update(chat.history, forget)

          for (let round = 0; round < rounds; round += 1) {
            const id = StepId.make(`thinking-${round}`)

            yield* Ref.set(thinking, Option.some(id))
            yield* send(Thinking.make({ id, state: Running.make({}) }))

            const response = yield* chat.generateText({
              prompt: round === 0 ? question : [],
              toolkit,
            })

            yield* think(Thought.make({}))

            const ending = endingOf(response)

            if (Option.isSome(ending)) return ending.value

            // No tool call means the model answered in words: it found no chart.
            if (response.toolCalls.length === 0) break
          }

          return Unanswered.make({})
        })

        // A shown chart gets its takeaway before the answer ends.
        const answered = Effect.gen(function* () {
          const ending = yield* decided

          if (isShown(ending)) {
            const id = StepId.make("takeaway")

            yield* send(Takeaway.make({ id, state: Running.make({}) }))

            const written = yield* takeaway(chat, ending)

            yield* send(Takeaway.make({ id, state: written.state }))
            yield* send(written.answered)
          } else {
            yield* send(ending)
          }
        })

        yield* answered.pipe(
          Effect.provideService(Report, report),
          Effect.provideService(LanguageModel.LanguageModel, model),
          Effect.catchTag("AiError", (error) =>
            Effect.logWarning("Language model failed", error.reason).pipe(
              Effect.andThen(think(Failed.make({ reason: new AgentUnavailable() }))),
              Effect.andThen(Effect.fail(new AgentUnavailable())),
            ),
          ),
        )
      })

      const ask = (chat: Chat.Chat, question: string) =>
        Stream.callback<Step, Failure>((queue) =>
          answer(chat, { question, queue }).pipe(Effect.andThen(Queue.end(queue))),
        )

      const explain = Effect.fn("Agent.explain")(
        function* (view: View) {
          const data = summarize(yield* resolver.resolve(view))

          const response = yield* model.generateText({
            prompt: [
              {
                role: "system",
                content: `You write the takeaway for a chart of public data, given the chart and its data: ${rules}`,
              },
              { role: "user", content: JSON.stringify({ view, data }) },
            ],
          })

          return Option.match(check(response.text, data), {
            onNone: () => Answered.make({ view }),
            onSome: ({ text }) => Answered.make({ view, takeaway: text }),
          })
        },
        Effect.catchTag("AiError", (error) =>
          Effect.logWarning("Language model failed on a takeaway", error.reason).pipe(
            Effect.andThen(Effect.fail(new AgentUnavailable())),
          ),
        ),
      )

      return Agent.of({ start, ask, explain })
    }),
  ).pipe(Layer.provide(ToolsLayer))

  static readonly unavailable = Layer.succeed(
    Agent,
    Agent.of({
      start: Chat.empty,
      ask: () => Stream.fail(new AgentUnavailable()),
      explain: () => Effect.fail(new AgentUnavailable()),
    }),
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
