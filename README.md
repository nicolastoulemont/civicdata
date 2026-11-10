# civicdata

civicdata makes data about the economy and public policy easier to read and understand. You ask a question in your own words, such as "How has unemployment in Spain changed since 2000?", and get charts of official figures from the World Bank, Eurostat or the OECD, the assistant's account of what they show, and the source of every charted number. It is for people who want to follow how a country is doing without being statisticians.

![An answer: the question, a line chart of Spain's unemployment rate from 2009 to 2025, a two-sentence takeaway, and the line "Source: Eurostat, Unemployment rate - annual data. Retrieved 9 November 2026."](docs/answer.webp)

## What you can do

- Ask about one country or several. The answer is a line over the years, a ranking of countries in one year as bars or a map (of the narrowest region holding every country, such as Europe, North Africa or East Asia, else the world), the change between two years, or one indicator plotted against another.
- Read what the assistant writes before, between and after the charts, as much as the question needs. Once you change a chart, the answer's words grey out, and "Explain this chart" asks what the changed chart shows.
- Change the chart where it is: add countries, pick the years, switch the chart type, or show the values per person, as yearly growth, as an index or as a ratio of another indicator. None of these changes calls the assistant.
- Follow up in the same conversation, such as "add Portugal" or "now per person". A follow-up starts from the chart as you last changed it.
- Open About for what the indicator measures and what its source writes about it: the World Bank's notes on why it matters, its limits and its method, Eurostat's on how it measures the data and how far it compares across countries and over time, and the OECD's on the chart's countries. A World Bank indicator also lists related indicators to chart instead. Open Data for every value in a table, a CSV download, and a link to the request made to the source.
- On a trend chart of EU and OECD members, turn on Elections, Governments and Events: a mark for each national election, a band for each government, and major events and pension reforms, each with its source.
- See which values a source flags as provisional, estimated or a break in series, and where another source publishes a different figure for the same measure.
- Share a chart with its link. The link opens the same chart, and its preview card shows the chart with its source.
- Go back to an earlier conversation from the sidebar, which shows how its last question stands: still being answered, answered, waiting for your reply, no data, or stopped. The list is kept in your browser only, and a conversation is deleted 30 days after its last question.

## How it keeps numbers honest

- Every value on a chart comes from a request to the World Bank, Eurostat or the OECD. World Bank and Eurostat charts read our stored copy of each series, which a daily Workflow refreshes when the source publishes a new release and never overwrites with an answer that drops values. Other fetched series are reused for a day, or until Eurostat's next twice-daily update.
- The assistant chooses an indicator, countries and years; it never supplies a value. It may only use an indicator code that the catalog search returned, and the server checks the chart it asks for and sends any problem back for it to fix.
- The assistant's words are not checked against the data. They may round a value or work out a difference; the chart beside them shows the published values.
- A chart's plain title may reword the source's name for the indicator but may not add a number to it, and the official name stays on the chart.
- Every chart, shared link and preview card carries a source line: the publisher, the dataset and the day the data was retrieved.
- When a chart crosses a break in series, the assistant is told the country and year, and its instructions tell it to say so and name the source that marks it. Asked why a line jumps, why two sources differ or how a figure is measured, it reads the source's notes and answers from them, naming the source.
- An eval asks the assistant 80 questions, some with follow-ups, and checks each chart's type, indicator, countries, transform and years against the answers the case accepts. It runs only when the owner asks for a run, never as part of a change's checks.
- Elections, governments, events and reforms are dated records, each with its source. The chart shows when they happened beside the data and never says they caused a change: no winner or coalition is read into an election, and the events were ported without the notes on how each may move a chart. The assistant reads these records through a tool, and its instructions tell it to name only records it looked up.
- The assistant explains why a figure moved only by citing a research finding: one result of reviewed studies, in our words, marked as agreed, resting on one study, or disputed with both sides. Hover a cited finding to see its studies, each linked to a copy anyone can read. When no finding covers a question, the assistant says so and states no cause.

## Sources and licences

| Source                                                 | What it adds                                                                                                                          | Licence                                                                                                                     | Credit on the chart                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| World Bank, World Development Indicators               | Indicators for every country, for comparisons across the world                                                                        | [CC BY 4.0](https://datacatalog.worldbank.org/search/dataset/0037712)                                                       | Publisher, dataset and retrieval date                  |
| World Bank, Worldwide Governance Indicators            | Six governance dimensions, such as rule of law and control of corruption, since 1996, republished in the World Development Indicators | [CC BY 4.0](https://datacatalog.worldbank.org/search/dataset/0038026)                                                       | Publisher, dataset and retrieval date                  |
| Eurostat                                               | Detailed EU and EFTA statistics, split by sex, age and other dimensions                                                               | [Reuse with the source acknowledged](https://ec.europa.eu/eurostat/help/copyright-notice) (Commission Decision 2011/833/EU) | Publisher, dataset and retrieval date                  |
| OECD                                                   | Statistics for OECD members, including those outside the EU                                                                           | [Reuse for any purpose, crediting the dataset](https://www.oecd.org/en/about/terms-conditions.html)                         | Publisher, dataset and retrieval date                  |
| [PPEG 2025v1](https://ppeg.wzb.eu/) (WZB Berlin)       | Cabinets, lower-house and presidential elections of 43 EU and OECD members, to 31 October 2025                                        | CC0 1.0                                                                                                                     | PPEG (Krause, Döring, Stoppe, WZB Berlin, 2025)        |
| [ParlGov](https://parlgov.fly.dev/) (Döring and Manow) | Cabinets and lower-house elections of 37 members, to June 2023, for the years before PPEG's coverage                                  | CC0 1.0                                                                                                                     | ParlGov (Döring and Manow, 2024)                       |
| Official pages, checked by hand                        | Cabinets and elections since, 24 major events and 20 pension reforms, in `packages/server/src/official/`                              | Facts, linked per record                                                                                                    | The government, parliament or electoral authority page |
| Research findings, reviewed by hand                    | Findings on why figures moved, each with its studies, in `packages/server/src/research/`                                              | Our own wording and the studies' bibliographic data; no paper text                                                          | Each study, in the finding's card                      |

The Worldwide Governance Indicators are perceptions, which the World Bank says are estimates and not an official rating of a country's governance. Its [usage advisory](https://www.worldbank.org/en/publication/worldwide-governance-indicators/usage-advisory) forbids republishing the rescaled values of five licensed underlying sources; civicdata charts only each dimension's estimate and score.

PPEG and ParlGov ask for no credit under CC0; the chart cites them as they ask to be cited. How the three sets of political records combine is in [docs/catalog.md](docs/catalog.md#political-records).

## Develop

| Path              | What it holds                                                                          |
| ----------------- | -------------------------------------------------------------------------------------- |
| `apps/web`        | TanStack Start app. `src/routes/api/$.ts` hands every `/api` request to Effect         |
| `packages/domain` | Schemas and the `HttpApi` definition, shared by the server and the web client          |
| `packages/server` | Effect `HttpApi` handlers, exposed as a web `handle(request)`                          |
| `packages/infra`  | Alchemy stack: the Worker, D1, R2 and Vectorize. The only package that imports Alchemy |

The app deploys as one Cloudflare Worker. Alchemy builds `apps/web` with its own Cloudflare Vite plugin, so `vite.config.ts` stays free of Cloudflare code.

### Toolchain

- Node 24 and pnpm 12. The pnpm version comes from `packageManager`.
- TypeScript 7 with the Effect language service (`@effect/tsgo`). Effect diagnostics such as `floatingEffect` fail `typecheck`.
- Oxlint with type-aware rules, oxfmt, and Fallow for dead code, duplication and complexity.
- Turborepo runs `typecheck`, `test` and `build` per package.
- Vitest 5 with `@effect/vitest`. Server tests run inside workerd through `@cloudflare/vitest-plugin`, with the same compatibility date as the deployed Worker.

```sh
pnpm install
pnpm dev          # the app in the Workers runtime with local D1 and R2: http://localhost:1337
pnpm dev:web      # the web app alone in Node, no D1 or R2, no Cloudflare login needed
pnpm storybook    # each chart type alone, drawn from recorded World Bank data: http://localhost:6006
pnpm check        # format, lint, fallow, typecheck, test, build: what CI runs
```

A question on the home page opens a conversation at `/c/<id>`, where follow-ups like "add Mexico" change the last chart. Each conversation lives in its own Durable Object, which runs the agent and keeps the questions and charts until 30 days after the last question. An answer runs to its end and is kept even if the visitor leaves; a visitor who comes back while it runs sees it continue. The id is a random UUID made by the browser; whoever has the link can read the conversation. The agent runs on an OpenAI model. To ask them locally, copy `packages/infra/.env.example` to `packages/infra/.env` (gitignored) and fill in `OPENAI_API_KEY`; `alchemy dev` reads that file when it starts, and a variable exported in your shell overrides it. Set `OPENAI_MODEL` there to try another model than the default in `packages/server/src/Agent.ts`. Without a key the app works and every question answers "The assistant is not available".

`pnpm dev` runs `alchemy dev` for the `dev_<user>` stage. Alchemy emulates D1, R2, Durable Objects and Workflows locally and serves the web app from the Workers runtime with hot reload, so the series cache works as deployed. Local Workflows run no schedules, so the local catalog and store stay empty: indicator search answers "unavailable" and charts ask their source (see [docs/catalog.md](docs/catalog.md) and [docs/series.md](docs/series.md)). It needs your Cloudflare login, because the stage's state lives in your Alchemy state store. Vectorize and Workers AI have no local emulation: the stage creates a real Vectorize index in your account, and search by meaning calls Workers AI there. Nothing else is deployed. `pnpm dev:web` needs no login but runs in Node, where there is no D1, R2 or Durable Object: charts load uncached, and indicator search and questions answer "unavailable".

`pnpm install` runs `effect-tsgo patch --typescript`, which patches TypeScript in `node_modules` so the editor loads the Effect plugin. Scripts call `effect-tsgo tsc`, so they don't depend on the patch.

### Agent eval

`RUN_AGENT_EVAL=1 pnpm --filter @civicdata/server eval` asks the agent every question in `packages/server/eval/cases.ts` and checks each final chart against the charts the case accepts: chart type, indicator, countries, transform, and the years the question names. A failed case lists what differed, e.g. `indicator GC.DOD.TOTL.CN, want GC.DOD.TOTL.GD.ZS`. It runs in workerd against OpenAI and the sources' recorded answers, builds the catalog first, reads `OPENAI_API_KEY` and `OPENAI_MODEL` like `alchemy dev` does, and takes about 25 minutes. Each question costs a few model requests, so CI never runs it, and without `RUN_AGENT_EVAL=1` its config refuses to start.

Run it only on request. A change to the prompt, the tools or the model doesn't need a run of its own: the owner asks for one when a run is worth its tokens, then compares the passed count with the last run. A change that adds or edits cases needs no run either, since `pnpm check` typechecks them. A case that fails with `SourceUnavailable` asked a source live and was refused; rerun it alone with `-t "<question>"`.

`packages/server/eval/recordings` holds one gzipped JSON file per request the eval made to a source: its URL, `Accept` header, retrieval time, status and body. The eval answers a request from its file and never asks the source, so a run spends almost none of the OECD's 60 requests an hour. A request without a file goes to the source through the pacer, and its answer is saved for the next run; commit the new files. At the end, a run prints the requests it sent to each source, the answers it replayed, and the OpenAI tokens it used, in total and for the five cases that used the most. To refresh a source's answers, delete its folder (`oecd`, `eurostat` or `world-bank`) and run the eval. A refresh asks the OECD about 50 times, so refresh it at most once an hour. A replayed series reports the run's time as its retrieval time, since the adapters stamp an answer when it arrives; the file keeps when the source sent it.

### Editor

`.vscode/settings.json` points VS Code at the workspace TypeScript 7. Install the TypeScript 7 extension. Effect diagnostics then show up in the editor.

### Supply chain

`pnpm-workspace.yaml` sets the install policy:

- `minimumReleaseAge: 1440`: pnpm only installs versions that are at least one day old.
- `trustPolicy: no-downgrade`: install fails if a package loses its provenance.
- `blockExoticSubdeps`: no git or tarball URLs deeper in the tree.
- `strictDepBuilds`: install fails on dependency build scripts not listed in `allowBuilds`. Only `workerd` is listed.

### More

- [docs/catalog.md](docs/catalog.md): how the weekly Workflow builds the indicator catalog and stores the political records, and how to rebuild a stage by hand.
- [docs/series.md](docs/series.md): how the daily Workflow stores every World Bank indicator and Eurostat series, holds back an answer that drops values, and how charts read the store.
- [docs/deploys.md](docs/deploys.md): stages per pull request and for `main`, the one-time setup, deploying your own stage, and upgrading Alchemy.
