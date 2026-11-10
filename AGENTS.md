# AGENTS.md

civicdata charts public data about countries from the World Bank, Eurostat and the OECD. The README covers what the app does, its sources, layout and commands; `docs/catalog.md` covers the catalog and political-records builds, `docs/series.md` the stored series, and `docs/deploys.md` covers deploys. This file covers what the code does not show.

## Product rules

- Every value a chart shows comes from a fetched observation that carries its provenance: source, dataset, URL, retrieval time. Code never computes a charted value from memory or model output. The agent's own words sit beside the charts and are not checked against the data.
- Every reason the agent gives for why a figure changed cites a research finding from `packages/server/src/research/findings.json`, the same way every number comes from a fetched observation. The agent states no cause from the model's own knowledge, and events stay causeless: their summaries say what happened, never what it did to a chart. A finding stores our own wording and each study's bibliographic data, never the papers' text, and every study links a copy anyone can read that someone opened and read before adding it (see `packages/server/src/research/README.md`).
- Source attribution stays visible on every chart, including shared and embedded ones. The World Bank, Eurostat and OECD all require it.

## Effect

- Writing or reviewing Effect code (services, layers, schemas, HTTP clients, errors, tests): read `.agents/skills/effect/SKILL.md` and the references its branch chooser names. Where it disagrees with this file, this file wins. Skills live in `.agents/skills/`; `.claude/skills` is a symlink to it so Claude Code finds them too.
- Effect 4.1 docs ship in `node_modules/effect/ai-docs` and its source in `node_modules/effect/src`. Read those before guessing an API; most web examples target 3.x or 4.0 prereleases. Modules live at `effect/http`, `effect/http-api` and `effect/ai`.
- `typecheck` runs the Effect language service, and Effect warnings fail it. `allowedUnstableApis` in `tsconfig.base.json` lists the unstable modules we accept; add a module there as a deliberate choice, never to silence a diagnostic.

## UI

- Build all UI from shadcn components (Base UI primitives, style `base-nova`) in `apps/web/src/components/ui/`. Before writing UI, search for a matching component with `pnpm --filter @civicdata/web exec shadcn search @shadcn -q <term>`, add it with `pnpm --filter @civicdata/web exec shadcn add <name>`, then run `pnpm format`.
- When no shadcn component fits, stop and ask the user what to use: a composition of existing components, a Base UI primitive, a third-party library, or a custom component. Do not hand-roll a component or add a UI library without that answer.
- Component files are ours to edit for behavior and accessibility; `shadcn add --overwrite` discards those edits. They must typecheck, but `.oxlintrc.json` turns off the lint rules shadcn's code does not follow (runtime `typeof`, unchecked casts, wrapper roles) for `components/ui/**` only, and Fallow skips their complexity. App code keeps every rule.
- Type a component's props with a named type, `interface <Component>Props` (or `type <Component>Props` for a union or intersection), declared above the component. Never annotate props with an inline type. `anti-slop/require-named-props-type` enforces this outside `components/ui/**`.
- Style with the theme tokens defined in `apps/web/src/styles.css` (`bg-background`, `text-muted-foreground`, ...), never raw colors. Two colours come from data instead: a party's sourced colour on its government's band, and each country's own colour in `apps/web/src/explore/colors.gen.ts`, which charts read through `color` in `palette.ts` and the share card reads directly. Change a country's colour by regenerating that file (`scripts/flags.ts`, `scripts/colors.ts`), never by hand.
- A link stays an `<a>` or router `<Link>` styled with `buttonVariants`. Base UI's `Button` forces button semantics and its docs forbid rendering a link through it.
- Base UI's docs ship in `node_modules/@base-ui/react/docs`; `shadcn docs <component>` links a component's docs and examples.

## Tests

- Backend tests use `@effect/vitest` and fake a service's dependencies with layers, following the Effect skill's `references/TESTING.md` (`TestService` / `testLayer`). An HTTP adapter's own tests fake its `HttpClient` layer with recorded responses.
- Server tests run inside workerd through `@cloudflare/vitest-plugin`. Its compatibility date must match the one in `packages/infra/alchemy.run.ts`.
- Frontend tests render the feature with its real providers and fake HTTP with MSW. Register handlers on `network` from `apps/web/test/network.ts`; a request no handler answers fails the test. Use same-origin URLs: happy-dom sends a CORS preflight before any cross-origin request.
- Module mocking (`vi.mock`) fails lint. Fake through layers or MSW instead.
- The agent eval (`packages/server/eval`) is not a check. Run it only when the user asks for an eval run in the current task: never to verify your own change, before pushing, or because you changed the prompt, a tool or the model. Its config refuses to start unless `RUN_AGENT_EVAL=1` is set; set it only under such a request. Adding or editing cases needs no run, since `pnpm check` typechecks them.

## Cloudflare Workers

- Workers forbid timers, random values and I/O at module scope, outside a request. Build Effect runtimes and handlers on the first request, as `packages/server/src/index.ts` does.
- App code reads bindings from `cloudflare:workers` and wraps each in its own Effect layer. Import it dynamically inside the layer and fall back when it is missing, as `Cache.layer` in `packages/server/src/Cache.ts` does: `pnpm dev:web` and the Node build run outside Workers, where the module does not exist (`apps/web/vite.config.ts` marks it external). Only `packages/infra` imports Alchemy (lint enforces it), and `vite.config.ts` gets no Cloudflare plugin: Alchemy adds its own at build time.

## Tooling gotchas

- pnpm refuses package versions published less than a day ago, and any dependency build script not listed under `allowBuilds` in `pnpm-workspace.yaml`. Review a build script before allowing it.
- `pnpm deploy` is a pnpm built-in. Run the infra script with `pnpm --filter @civicdata/infra run deploy`.
- `pnpm dev` runs `alchemy dev`, which emulates D1 and R2 locally (`create (local)` in its log). Stopping it can leave a child process listening on port 1337; free the port before restarting.
- Run `pnpm check` before pushing; it is the CI gate.
- Fallow enforces the package import direction (web -> server -> domain; nothing imports infra). A new package or top-level source folder needs a zone in `.fallowrc.json`, or `pnpm check` fails.

## Vendored code

- `tools/oxlint/anti-slop/` holds lint rules we own and may edit. Record every local change and upstream update in its `UPSTREAM.md`.
- `.agents/skills/effect/` is kept identical to upstream. Change it only by updating from upstream, as its `UPSTREAM.md` describes.
- `.agents/skills/fallow/` and `.agents/skills/fallow-setup/` are pointers written by `pnpm exec fallow agent install --harness codex --without guide --without mcp --without hooks`. Rerun it after upgrading `fallow`; the flags keep it from adding MCP servers, commit hooks or an `AGENTS.md` block.

## Git

- Conventional commits. The title says why the change matters; the body describes the behavior.
- Pull requests squash-merge into `main`. Each same-repo pull request deploys a `pr-<n>` preview.
