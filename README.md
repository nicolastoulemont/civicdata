# civicdata

Ask a question about the state of a country and get a chart built from World Bank, Eurostat and OECD data, with the source of every number.

## Layout

| Path              | What it holds                                                                          |
| ----------------- | -------------------------------------------------------------------------------------- |
| `apps/web`        | TanStack Start app. `src/routes/api/$.ts` hands every `/api` request to Effect         |
| `packages/domain` | Schemas and the `HttpApi` definition, shared by the server and the web client          |
| `packages/server` | Effect `HttpApi` handlers, exposed as a web `handle(request)`                          |
| `packages/infra`  | Alchemy stack: the Worker, D1, R2 and Vectorize. The only package that imports Alchemy |

The app deploys as one Cloudflare Worker. Alchemy builds `apps/web` with its own Cloudflare Vite plugin, so `vite.config.ts` stays free of Cloudflare code.

## Toolchain

- Node 24 and pnpm 12. The pnpm version comes from `packageManager`.
- TypeScript 7 with the Effect language service (`@effect/tsgo`). Effect diagnostics such as `floatingEffect` fail `typecheck`.
- Oxlint with type-aware rules, oxfmt, and Fallow for dead code, duplication and complexity.
- Turborepo runs `typecheck`, `test` and `build` per package.
- Vitest 5 with `@effect/vitest`. Server tests run inside workerd through `@cloudflare/vitest-plugin`, with the same compatibility date as the deployed Worker.

```sh
pnpm install
pnpm dev          # the app in the Workers runtime with local D1 and R2: http://localhost:1337
pnpm dev:web      # the web app alone in Node, no D1 or R2, no Cloudflare login needed
pnpm check        # format, lint, fallow, typecheck, test, build: what CI runs
```

A question on the home page opens a conversation at `/c/<id>`, where follow-ups like "add Mexico" change the last chart. Each conversation lives in its own Durable Object, which runs the agent and keeps the questions and charts until 30 days after the last question. An answer runs to its end and is kept even if the visitor leaves; a visitor who comes back while it runs sees it continue. The id is a random UUID made by the browser; whoever has the link can read the conversation. The agent runs on an OpenAI model. To ask them locally, copy `packages/infra/.env.example` to `packages/infra/.env` (gitignored) and fill in `OPENAI_API_KEY`; `alchemy dev` reads that file when it starts, and a variable exported in your shell overrides it. Set `OPENAI_MODEL` there to try another model than the default in `packages/server/src/Agent.ts`. Without a key the app works and every question answers "The assistant is not available".

`pnpm dev` runs `alchemy dev` for the `dev_<user>` stage. Alchemy emulates D1, R2, Durable Objects and Workflows locally and serves the web app from the Workers runtime with hot reload, so the series cache works as deployed. Local Workflows run no schedules, so the local catalog stays empty and indicator search answers "unavailable" (see Indicator catalog). It needs your Cloudflare login, because the stage's state lives in your Alchemy state store. Vectorize and Workers AI have no local emulation: the stage creates a real Vectorize index in your account, and search by meaning calls Workers AI there. Nothing else is deployed. `pnpm dev:web` needs no login but runs in Node, where there is no D1, R2 or Durable Object: charts load uncached, and indicator search and questions answer "unavailable".

`pnpm install` runs `effect-tsgo patch --typescript`, which patches TypeScript in `node_modules` so the editor loads the Effect plugin. Scripts call `effect-tsgo tsc`, so they don't depend on the patch.

### Indicator catalog

Indicator search reads a catalog of World Bank indicators, Eurostat datasets and OECD dataflows, kept in D1 for search by words and in Vectorize for search by meaning. Searches only read it. The `CatalogWorkflow` Workflow (`packages/server/src/CatalogBuild.ts`) builds it every Monday at 04:00 UTC from a native Workflow schedule, and CI starts one more build after each deploy, through the Workflows API.

A build lists each source in one request, writes its entries into a new generation, embeds them 100 at a time, then publishes the generation, which drops the source's older ones. Each of those is a Workflow step: a failed step retries alone, for about half an hour, and a resumed build skips the steps that completed. Sources build side by side, so one that stays down keeps its previous generation while the others publish. A stage answers "unavailable" to every search until its first build publishes a source. Eurostat's list carries names only: its full list with descriptions is 20 MB.

The write step first compares a fingerprint of the listing with the one stored beside the source's published generation (`catalog_fingerprint`). The fingerprint is a SHA-256 of the sorted entries and the embedding model, so a deploy that changes either rebuilds the source. When they match, the step writes nothing and the source stops there, keeping its published generation. The step saves that decision, so a resumed build makes the same one. A build where no source changed makes one listing request per source, three steps and no Workers AI calls. A new stage, or one whose generations predate fingerprints, builds everything once.

### Political records

Trend charts can mark each country's national elections and shade who governed it, for the EU and OECD members. The same `CatalogWorkflow` run stores elections and governments in D1 (`packages/server/src/PoliticsBuild.ts`), one generation per publisher and kind like the catalog, and `GET /api/politics?countries=ESP,PRT&from=2000&to=2020` reads them (`packages/server/src/Politics.ts`):

| Publisher                                              | What it records                                                                    | Licence                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------ |
| [PPEG 2025v1](https://ppeg.wzb.eu/) (WZB Berlin)       | Cabinets, lower-house and presidential elections of 43 members, to 31 October 2025 | CC0 1.0                  |
| [ParlGov](https://parlgov.fly.dev/) (Döring and Manow) | Cabinets and lower-house elections of 37 members, to June 2023                     | CC0 1.0                  |
| Official pages, checked by hand                        | Cabinets and elections since, in `packages/server/src/official/`                   | Facts, linked per record |

PPEG counts within its coverage, ParlGov fills the years before it, and records checked by hand follow both. PPEG and ParlGov can date the same election differently (France's first or second round), so they are never added together. The sources record when a government starts, never when it ends: it ends when the next starts. No winner or coalition is inferred from an election. European Parliament elections are left out. The chart credits PPEG and ParlGov with the citations they ask for.

The same route answers major events and pension reforms from a snapshot checked in beside the official pages (`events.json`, `reforms.json`, ported from countries-comparison; see `official/README.md`). Every record cites at least one https page, which the card's source line links. An event shows on a country's chart only if it concerns that country, and a reform only on a chart of its policy area: `areas` in `packages/domain/src/Politics.ts` lists the Eurostat and OECD indicators of each. No build stores them, but the route still answers "unavailable" until the first build stores elections and governments.

Like the catalog's, the write step skips a publisher's records of one kind when their fingerprint matches the published generation's (`politics_fingerprint`). The fingerprint leaves out when the build fetched them, which changes every build, so skipped records keep the retrieval time of the build that stored them. A build where nothing changed makes six steps.

To rebuild a deployed stage by hand, start an instance from the Cloudflare dashboard (Workers & Pages, Workflows, `civicdata-<stage>-catalog`) or with `POST /accounts/<account>/workflows/civicdata-<stage>-catalog/instances`.

### Agent eval

`pnpm --filter @civicdata/server eval` asks the agent every question in `packages/server/eval/cases.ts` and checks each final chart against the charts the case accepts: chart type, indicator, countries, transform, and the years the question names. A failed case lists what differed, e.g. `indicator GC.DOD.TOTL.CN, want GC.DOD.TOTL.GD.ZS`. It runs in workerd against the live sources and OpenAI, builds the catalog first, reads `OPENAI_API_KEY` and `OPENAI_MODEL` like `alchemy dev` does, and takes about three minutes. CI never runs it, since each question costs a few model requests.

Run it before changing the prompt, the tools or the model, and compare the passed count. A case that fails with `SourceUnavailable` hit a stalled World Bank request, not a wrong answer; rerun it alone with `-t "<question>"`.

### Editor

`.vscode/settings.json` points VS Code at the workspace TypeScript 7. Install the TypeScript 7 extension. Effect diagnostics then show up in the editor.

## Supply chain

`pnpm-workspace.yaml` sets the install policy:

- `minimumReleaseAge: 1440`: pnpm only installs versions that are at least one day old.
- `trustPolicy: no-downgrade`: install fails if a package loses its provenance.
- `blockExoticSubdeps`: no git or tarball URLs deeper in the tree.
- `strictDepBuilds`: install fails on dependency build scripts not listed in `allowBuilds`. Only `workerd` is listed.

## Deploys

| Trigger                     | Stage              | GitHub environment |
| --------------------------- | ------------------ | ------------------ |
| Pull request from this repo | `pr-<n>`           | `preview`          |
| Pull request closed         | `pr-<n>` destroyed | `preview`          |
| Push to `main`              | `prod`             | `production`       |

Deploys run only after the `check` job passes. Fork pull requests run `check` without secrets and never deploy. Each stage gets its own Worker, D1 database, R2 bucket and conversation Durable Objects. The `prod` D1 database survives `alchemy destroy`.

### One-time setup

1. Create a Cloudflare API token for CI. Alchemy's CI guide lists Workers Scripts, Workers R2 Storage, D1 and Secrets Store write access, plus Workers Tail read. Add Vectorize write access for the catalog's index. Trim it after the first deploy.
2. Bootstrap the Alchemy state store once, from a machine logged in to Cloudflare:
   ```sh
   pnpm --filter @civicdata/infra exec alchemy state bootstrap
   ```
3. In GitHub, create the `preview` and `production` environments. In each, add the secrets `CLOUDFLARE_API_TOKEN` and `OPENAI_API_KEY` and the variable `CLOUDFLARE_ACCOUNT_ID`. Limit `production` to the `main` branch. Fund the OpenAI project behind the key with prepaid credits and cap their auto-reload: that is the only limit on total spend. Each Worker limits one visitor to five questions a minute, and once the credits run out every question answers "The assistant is not available".
4. Protect the repository. Rulesets, dependency review, code scanning uploads and private vulnerability reporting need a public repository on GitHub's free plan. This repository has:
   - A `main` ruleset: pull request required, the `check` and `dependency-review` checks must pass (from GitHub Actions only), squash merges only, linear history, and no force pushes or deletion. It requires no approvals while there is one maintainer, because GitHub doesn't let you approve your own pull request.
   - A read-only default `GITHUB_TOKEN`, and approval required for workflow runs from all outside contributors.
   - Secret scanning with push protection, Dependabot alerts, and private vulnerability reporting.

To deploy your own stage from your machine, connect Cloudflare once with `pnpm --filter @civicdata/infra exec alchemy profile edit`, then run `pnpm --filter @civicdata/infra run deploy`. Keep the `run`: without it, pnpm runs its own `deploy` command instead of the script. The stage is named `live_<your user>` unless you pass `--stage`.

Alchemy is a beta that breaks things between releases. Upgrade it on a branch and let that branch's preview stage deploy before you merge. Every machine and CI job must run the same Alchemy version against the state store.
