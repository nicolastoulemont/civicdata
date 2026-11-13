import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { expect, it } from "@effect/vitest"
import { Cited, Paper, Text } from "@repo/domain"
import { Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { Checked, SupportUnavailable, Verdict } from "../Support.schemas.ts"
import { Support } from "../Support.ts"
import { paper } from "./papers.ts"

const recorded = () => {
  const state = {
    status: 200,
    body: "",
    rows: [
      {
        sentence: 0,
        judgement: Verdict.cases.Supported.make({ kind: "Association", evidence: [0] }),
      },
    ],
  }

  const client = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            {
              id: "review",
              model: "gpt-6-luna",
              created_at: 0,
              output: [
                {
                  id: "message",
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      annotations: [],
                      text: state.body || JSON.stringify({ sentences: state.rows }),
                    },
                  ],
                },
              ],
            },
            { status: state.status },
          ),
        ),
      ),
    ),
  )

  return {
    state,
    layer: Support.layer.pipe(
      Layer.provide(OpenAiLanguageModel.model("gpt-6-luna")),
      Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make("test") })),
      Layer.provide(client),
    ),
  }
}

const proposal = () =>
  Text.make({
    text: "Training was associated with employment [Study](cite:0).",
    cites: [Cited.cases.Paper.make({ paper: paper() })],
  })

it.effect(
  "keeps supported source claims and refuses a causal claim backed only by association",
  () => {
    const wire = recorded()

    return Effect.gen(function* () {
      const checker = yield* Support
      expect(Checked.guards.Accepted(yield* checker.review(proposal()))).toBe(true)
      wire.state.rows = [
        { sentence: 0, judgement: Verdict.cases.Supported.make({ kind: "Cause", evidence: [0] }) },
      ]
      expect(
        Checked.guards.Rejected(
          yield* checker.review(
            Text.make({
              text: "Training caused higher employment [Study](cite:0).",
              cites: [Cited.cases.Paper.make({ paper: paper() })],
            }),
          ),
        ),
      ).toBe(true)

      const causal = Paper.make({
        ...paper(),
        kind: "AuthorCausalEstimate",
        design: "AuthorCausalEstimate",
      })

      const parsed = yield* Paper.makeEffect(causal)
      expect(
        Checked.guards.Accepted(
          yield* checker.review(
            Text.make({
              text: "Training raised employment [Study](cite:0).",
              cites: [Cited.cases.Paper.make({ paper: parsed })],
            }),
          ),
        ),
      ).toBe(true)
    }).pipe(Effect.provide(wire.layer))
  },
)

it.effect(
  "rejects incomplete reviews, absent citations, invented evidence indices and uncertain support",
  () => {
    const wire = recorded()

    return Effect.gen(function* () {
      const checker = yield* Support
      wire.state.rows = []
      expect(Checked.guards.Rejected(yield* checker.review(proposal()))).toBe(true)
      wire.state.rows = [
        {
          sentence: 0,
          judgement: Verdict.cases.Supported.make({ kind: "Association", evidence: [8] }),
        },
      ]
      expect(Checked.guards.Rejected(yield* checker.review(proposal()))).toBe(true)
      wire.state.rows = [
        {
          sentence: 0,
          judgement: Verdict.cases.Supported.make({ kind: "Association", evidence: [0] }),
        },
      ]
      expect(
        Checked.guards.Rejected(
          yield* checker.review(Text.make({ text: "Training raised employment." })),
        ),
      ).toBe(true)
      wire.state.body = JSON.stringify({
        sentences: [{ sentence: 0, judgement: Verdict.cases.Uncertain.make({}) }],
      })
      expect(Checked.guards.Rejected(yield* checker.review(proposal()))).toBe(true)
    }).pipe(Effect.provide(wire.layer))
  },
)

it.effect("maps malformed model output and provider failure to a typed support failure", () => {
  const wire = recorded()

  return Effect.gen(function* () {
    const checker = yield* Support
    wire.state.body = "not JSON"
    expect(yield* checker.review(proposal()).pipe(Effect.flip)).toBeInstanceOf(SupportUnavailable)
    wire.state.status = 503
    expect(yield* checker.review(proposal()).pipe(Effect.flip)).toBeInstanceOf(SupportUnavailable)
  }).pipe(Effect.provide(wire.layer))
})

it.effect("withholds prose beyond the review bounds before asking the provider", () => {
  const wire = recorded()
  // An unusable response would produce SupportUnavailable if a request were made.
  wire.state.status = 503

  return Effect.gen(function* () {
    const checker = yield* Support
    expect(
      Checked.guards.Rejected(yield* checker.review(Text.make({ text: "a".repeat(20001) }))),
    ).toBe(true)
    expect(
      Checked.guards.Rejected(
        yield* checker.review(
          Text.make({ text: Array.from({ length: 65 }, () => "Sentence.").join(" ") }),
        ),
      ),
    ).toBe(true)
  }).pipe(Effect.provide(wire.layer))
})
