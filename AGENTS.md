# AGENTS.md

openfacts charts public data about countries from the World Bank, Eurostat and the OECD, with an assistant that picks the charts and writes beside them. The README covers the app, its sources, layout and commands. Read `docs/catalog.md` before changing the catalog or political-records builds, `docs/series.md` before changing stored series, `docs/deploys.md` before changing deploys, `docs/traces.md` before changing spans or what they record, and `docs/answers.md` before changing what the answer log keeps.

## Product rules

- Every charted value comes from a fetched observation that carries its provenance: source, dataset, URL, retrieval time. Code never computes a charted value from memory or model output. The assistant's prose sits beside the charts, unchecked against the data.
- Every cause the assistant gives for a change in a figure cites a research finding from `packages/server/src/research/findings.json`; with no finding, it states no cause. Events stay causeless: a summary says what happened, never what it did to a chart.
- A finding holds our own wording and each study's bibliographic data, never a paper's text, and links each study to an open-access copy that someone read before adding it. Read `packages/server/src/research/README.md` before adding or editing a finding.
- Source attribution stays visible on every chart, including shared and embedded ones: the World Bank, Eurostat and the OECD all require it.

- A gather records what it stored per unit it fetched. A run asks only for units whose version differs. A failure never causes another unit to be fetched again.

## Effect

- Before writing or reviewing Effect code, read `.agents/skills/effect/SKILL.md` and the references its branch chooser names. This file wins where they disagree.
- We run Effect 4.1, and most web examples target 3.x or 4.0 prereleases. Read `node_modules/effect/ai-docs` and `node_modules/effect/src` before guessing an API. The HTTP, HttpApi and AI modules import from `effect/http`, `effect/http-api` and `effect/ai`.
- `typecheck` runs the Effect language service and fails on its warnings. `allowedUnstableApis` in `tsconfig.base.json` lists the unstable modules we accept; add one as a deliberate choice, never to silence a diagnostic.

## State machines

- Model every state machine explicitly with `Machine.make` from `@civicdata/machine`, and run it in a component with `useMachine` from `apps/web/src/machine.ts`; only a trivial one, a single boolean with no work tied to it, stays a plain `useState` or `Ref`.

## UI

- Build all UI from shadcn components (Base UI primitives, style `base-nova`) in `apps/web/src/components/ui/`. Find one with `pnpm --filter @civicdata/web exec shadcn search @shadcn -q <term>`, add it with `pnpm --filter @civicdata/web exec shadcn add <name>`, then run `pnpm format`.
- When no shadcn component fits, stop and ask the user which to use: a composition of existing components, a Base UI primitive, a third-party library, or a custom component. Hand-roll a component or add a UI library only on that answer.
- Component files are ours to edit for behavior and accessibility, and `shadcn add --overwrite` discards those edits. Lint relaxes shadcn's patterns (runtime `typeof`, unchecked casts, wrapper roles) for `components/ui/**` only; app code keeps every rule.
- Type a component's props with a named `interface <Component>Props` (a `type` for a union or intersection) declared above the component, never inline.
- Style with the theme tokens in `apps/web/src/styles.css` (`bg-background`, `text-muted-foreground`, ...), never raw colours. Two colours come from data: a party's sourced colour on its government's band, and each country's colour in `apps/web/src/explore/colors.gen.ts`, which charts read through `color` in `palette.ts`. Change a country's colour by regenerating that file with `scripts/flags.ts` and `scripts/colors.ts`, never by hand.
- A link stays an `<a>` or router `<Link>` styled with `buttonVariants`: Base UI's `Button` forces button semantics, and its docs forbid rendering a link through it.
- Base UI's docs ship in `node_modules/@base-ui/react/docs`; `shadcn docs <component>` links a component's docs and examples.

## Tests

- Backend tests use `@effect/vitest` and fake a service's dependencies with layers (`TestService` / `testLayer`, in the Effect skill's `references/TESTING.md`). An HTTP adapter's tests fake its `HttpClient` layer with recorded responses.
- Server tests run inside workerd through `@cloudflare/vitest-plugin`, whose compatibility date must match the one in `packages/infra/alchemy.run.ts`.
- Frontend tests render the feature with its real providers and fake HTTP with MSW handlers registered on `network` from `apps/web/test/network.ts`; a request no handler answers fails the test. Use same-origin URLs: happy-dom sends a CORS preflight before any cross-origin request.
- Fake through layers or MSW; lint rejects module mocking (`vi.mock`).
- Evals: read `docs/evals.md` before running, reviewing, archiving or restoring assistant evals. Paid evals and probes run only on the user's explicit request for that run in the current task; `pnpm check` never needs one.

## Cloudflare Workers

- Workers forbid timers, random values and I/O at module scope. Build Effect runtimes and handlers on the first request, as `packages/server/src/index.ts` does.
- Read each binding from `cloudflare:workers` inside its own Effect layer, importing the module dynamically and falling back when it is missing, as `Cache.layer` in `packages/server/src/Cache.ts` does. `pnpm dev:web` and the Node build run outside Workers, where the module does not exist.
- Only `packages/infra` imports Alchemy, and `vite.config.ts` gets no Cloudflare plugin: Alchemy adds its own at build time.

## Tooling gotchas

- pnpm refuses package versions published less than a day ago, and any dependency build script not listed under `allowBuilds` in `pnpm-workspace.yaml`. Review a build script before allowing it.
- `pnpm deploy` is a pnpm built-in. Run the infra script with `pnpm --filter @civicdata/infra run deploy`.
- Stopping `pnpm dev` can leave a child process listening on port 1337; free the port before restarting.
- Run `pnpm check` before pushing; CI runs the same gate.
- Fallow enforces the package import direction: web -> server -> domain, web and server may import machine, and nothing imports infra. A new package or top-level source folder needs a zone in `.fallowrc.json`, or `pnpm check` fails.

## Vendored code

- `tools/oxlint/anti-slop/` holds lint rules we own and may edit. Record every local change and upstream update in its `UPSTREAM.md`.
- `.agents/skills/effect/` stays identical to upstream. Change it only by updating from upstream, as its `UPSTREAM.md` describes.
- `.agents/skills/fallow/` and `.agents/skills/fallow-setup/` are written by `pnpm exec fallow agent install --harness codex --without guide --without mcp --without hooks`. Rerun it after upgrading `fallow`; the flags keep it from adding MCP servers, commit hooks or an `AGENTS.md` block.

## Git

- Conventional commits: the title says why the change matters; the body describes the behavior.
- Pull requests squash-merge into `main`. Each same-repo pull request deploys a `pr-<n>` preview, which reads production's catalog and stored series. Add the `own-catalog` label to a pull request that changes what the catalog or the store holds or how either is built ([docs/deploys.md](docs/deploys.md#the-own-catalog-label)).
