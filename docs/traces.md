# Traces

The app records what it does as OpenTelemetry traces: the browser, the Worker, each conversation's Durable Object and both Workflows. Effect's own OTLP exporter (`effect/observability`) sends them; there is no OpenTelemetry SDK. A deployed stage sends them to Grafana Cloud, `pnpm dev` to a Grafana on your machine, and a stage with no endpoint records none.

Only traces are exported, no metrics or logs. Effect writes each log inside a span as an event of that span, so a warning such as "The model cited a record it did not look up" shows up on the span that raised it. Counts, rates and percentiles come from TraceQL over the spans (see [Reading the agent](#reading-the-agent)).

## What a trace holds

A question asked on the page is one trace:

```
question.ask                              browser: from the request to the answer's last step
  POST                                    browser: the request, which sends traceparent
    POST                                  Worker: the request
      POST                                the conversation's Durable Object
        Conversation.ask
          Conversation.answer
            Agent.answer                  invoke_agent: the question, rounds, ending
              Chat.generateText           one per round
                LanguageModel.generateText    the model request: model, tokens, what it wrote
                  execute_tool show_chart     a tool call: arguments, result, rejection
                    Resolver.resolve          the data behind it
                      Resolver.series         ...
```

| Part         | File                                        | Records                                                                                                                                                                 |
| ------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser      | `apps/web/src/traces.ts`                    | each question asked or followed (`question.ask`, `question.follow`), each API request, and each error the page did not catch (`page.error`)                             |
| Worker       | `packages/server/src/index.ts`              | each `/api` request and the work behind it                                                                                                                              |
| Conversation | `packages/server/src/ConversationObject.ts` | each request and the answer it starts; every span of a question carries `gen_ai.conversation.id`                                                                        |
| Agent        | `packages/server/src/Agent.ts`              | the answer, each model request and each tool call, named and attributed as OpenTelemetry's [GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) say |
| Workflows    | `CatalogWorkflow.ts`, `GatherWorkflow.ts`   | each run, under `CatalogWorkflow.run` or `GatherWorkflow.run`                                                                                                           |

The agent's spans record:

| Span                         | Attribute                                                                         | Holds                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Agent.answer`               | `gen_ai.operation.name`                                                           | `invoke_agent`                                                                   |
|                              | `civicdata.question`                                                              | the question                                                                     |
|                              | `civicdata.country`                                                               | the country Cloudflare placed the person in, as an alpha-3 code, or `unknown`    |
|                              | `civicdata.answer.rounds`                                                         | model requests it took                                                           |
|                              | `civicdata.answer.ending`                                                         | `answered`, `asked`, `unanswered` or `exhausted` (18 rounds still calling tools) |
|                              | `civicdata.charts.changed`                                                        | charts the person changed before asking                                          |
| `LanguageModel.generateText` | `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | set by `@effect/ai-openai`                                                       |
|                              | `civicdata.output`                                                                | what the model wrote and the tools it called                                     |
| `execute_tool <name>`        | `gen_ai.tool.name`, `gen_ai.tool.call.id`                                         | the tool and the call                                                            |
|                              | `parameters`, `civicdata.tool.result`                                             | what the model passed (Effect's Toolkit writes it) and what the tool answered    |
|                              | `civicdata.tool.rejection`                                                        | why the tool sent the call back for the model to fix                             |

The browser sends its resolved UI locale in `X-User-Locale` on API requests. The Worker records it as `civicdata.locale` on the HTTP span only when it is one of the eight supported locales. Missing or unsupported values add no attribute. This header is for logging; it does not change the assistant or source data.

Text attributes stop at 8,192 characters.

Grafana Cloud drops the GenAI conventions' content attributes on ingest: `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` never reach Tempo, while `gen_ai.tool.name` and every `civicdata.` attribute do. The agent writes its content under the names above instead.

A span that ends refusing a View ends as a success, with `civicdata.refusal` naming the refusal: `IndicatorNotFound`, `DimensionsMissing` or `TransformNotApplicable` (`settled` in `packages/server/src/Traces.ts`). The agent sends such a call back to the model and the page asks the person to pick, so nothing failed, and `status = error` finds only what did. An HTTP client span keeps OpenTelemetry's rule: a 4xx answer marks it failed, though the OECD answers 404 for a key without data.

Spans record the questions people ask, the country each was asked from and what the model writes, never an IP address or a request's headers. Grafana Cloud keeps them 14 days.

## Settings

| Binding                       | From                                      | Holds                                                                    |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | GitHub variable, or `packages/infra/.env` | the OTLP base URL; spans go to `<endpoint>/v1/traces`                    |
| `OTEL_EXPORTER_OTLP_HEADERS`  | GitHub secret, or `packages/infra/.env`   | `Name=value` pairs, values URI-encoded, e.g. `Authorization=Basic%20...` |
| `STAGE`                       | the Alchemy stage                         | `deployment.environment.name` on every server span                       |
| `VERSION`                     | `GITHUB_SHA` in CI                        | `service.version` on every server span                                   |
| `TRACE_LIMIT`                 | `packages/infra/alchemy.run.ts`           | span batches one visitor's browser may send a minute: 30                 |

The browser knows none of these. It sends its spans as JSON to `POST /api/otlp/v1/traces` on its own origin, and the Worker passes each batch on with the headers, so the key never reaches the page. With no endpoint the route accepts each batch and drops it. The route makes no spans of its own and takes at most 64 KiB, a browser's limit for a request sent as the page closes.

## Locally

`pnpm dev` starts Grafana's all-in-one image, which holds Tempo and Grafana (`compose.yaml`), waits until it is ready, and points the app's spans at it on port 4318. It needs Docker running. Every checkout shares the one container.

Ask a question, then open Grafana at http://localhost:3000 (it signs you in), choose Explore, then Tempo, and search for `{ resource.service.name = "civicdata-web" }`. The container keeps its traces until `docker compose down`.

`pnpm dev:web` starts no Grafana. Run `docker compose up --detach` and export `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in your shell to trace it.

## Grafana Cloud

The free tier holds 50 GB of traces a month, kept 14 days. A question's trace is a few kilobytes, and a Workflow run's a few megabytes.

1. Create a free Grafana Cloud stack. In its portal, open the stack's OpenTelemetry (OTLP) tile, create a token, and copy the endpoint and the `OTEL_EXPORTER_OTLP_HEADERS` value it prints.
2. In GitHub, in both the `preview` and `production` environments, add the variable `OTEL_EXPORTER_OTLP_ENDPOINT` and the secret `OTEL_EXPORTER_OTLP_HEADERS`. The next deploy of each stage sends its spans.

Previews and production share the stack. Tell them apart with `resource.deployment.environment.name`, e.g. `{ resource.deployment.environment.name = "prod" }`.

## Dashboard

`grafana/openfacts.json` is one dashboard, built on TraceQL queries over the spans, so it adds no metric series to bill. Its Stage picker filters every panel to one stage, `prod` by default, except the page error panels: browser spans carry no stage, so the browser panels keep the questions whose trace reached that stage's Worker, and page errors count every stage.

| Row                  | Shows                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Questions            | answers run, how they ended, tool calls sent back, tokens, and the time a visitor waits for an answer                       |
| Agent                | rounds per answer, tool calls and rejections by tool, tool and answer time, the calls sent back with why, answers with none |
| Model                | input and output tokens, and model request time                                                                             |
| Requests and sources | requests, failures and time by route, and failures and time by source host                                                  |
| Page and workflows   | errors the page did not catch, and each Workflow run                                                                        |
| Volume               | spans sent by service, which is what Grafana Cloud bills                                                                    |

`pnpm dev` loads it into the local Grafana, which rereads the file when it changes. Grafana there won't save edits to a dashboard it loaded from a file: edit the JSON, or edit a copy in Grafana and paste its JSON (Edit, then Settings, then JSON Model) into the file.

In Grafana Cloud, import it once: Dashboards, then New, then Import, then upload `grafana/openfacts.json`. Import it again after the file changes, choosing to overwrite.

## Reading the agent

For a question the dashboard does not answer, Explore with Tempo runs TraceQL queries such as these; the ones with `|` draw a chart over time.

| Question                                            | TraceQL                                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How do answers end?                                 | `{ span.gen_ai.operation.name = "invoke_agent" } \| rate() by (span.civicdata.answer.ending)`                                                                          |
| Which answers ran out of rounds?                    | `{ span.civicdata.answer.ending = "exhausted" }`                                                                                                                       |
| How many rounds does an answer take?                | `{ span.gen_ai.operation.name = "invoke_agent" } \| quantile_over_time(span.civicdata.answer.rounds, .5, .9)`                                                          |
| Which tool calls did the server send back, and why? | `{ span.civicdata.tool.rejection != nil }`                                                                                                                             |
| How often does each tool get sent back?             | `{ span.civicdata.tool.rejection != nil } \| rate() by (span.gen_ai.tool.name)`                                                                                        |
| Which tools are slow?                               | `{ span.gen_ai.operation.name = "execute_tool" } \| quantile_over_time(duration, .9) by (span.gen_ai.tool.name)`                                                       |
| How many tokens do answers use?                     | `{ name = "LanguageModel.generateText" } \| sum_over_time(span.gen_ai.usage.input_tokens)`                                                                             |
| One conversation, every question                    | `{ span.gen_ai.conversation.id = "<id from /c/<id>>" }`                                                                                                                |
| Which Views did the data refuse?                    | `{ span.civicdata.refusal != nil } \| rate() by (span.civicdata.refusal)`                                                                                              |
| Errors the page did not catch                       | `{ resource.service.name = "civicdata-web" && name = "page.error" }`                                                                                                   |
| Sources that failed: a 5xx, a 429 or no answer      | `{ kind = client && (span.http.response.status_code >= 500 \|\| span.http.response.status_code = 429 \|\| (status = error && span.http.response.status_code = nil)) }` |

Open a trace from any result to see its waterfall: each round, what the model wrote, each tool it called with its arguments and result, and the source requests behind it.

## From Claude Code

`.mcp.json` adds Grafana Cloud's hosted MCP server to every checkout, so an agent can run these queries and read the dashboard itself, and `.claude/settings.json` approves it. Set it up once per person:

1. In the Grafana Cloud stack, enable Grafana Assistant. The MCP server is part of it, and each person who signs in counts as an active Assistant user.
2. Start `claude` in the repository, run `/mcp`, choose `grafana`, and sign in. On the consent screen, keep Read and Query access and clear Write access: debugging needs TraceQL queries, never changes to the stack.

A failing request's trace id is the second field of the `traceparent` header the page sends, in the browser's network panel.

## Adding spans

Name an operation with `Effect.fn("Service.operation")`; it becomes a span with that name. Put facts a question about the trace would filter on in attributes, with `Effect.annotateCurrentSpan`. An attribute of the agent's follows the GenAI conventions where one exists and Grafana Cloud keeps it, and takes a `civicdata.` name otherwise.

Tests read spans with `recording()` in `packages/server/test/fakes.ts`, and the spans the page exports with `exportedSpans()` in `apps/web/test/network.ts`.
