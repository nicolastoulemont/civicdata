# AGENTS.md

civicdata charts public data about countries (World Bank first, then Eurostat and OECD). The README covers layout, commands and deploys. This file covers what the code does not show.

## Product rules

- Every number a user sees comes from a fetched observation that carries its provenance: source, dataset, URL, retrieval time. Code never computes a displayed figure from memory or model output.
- Source attribution stays visible on every chart, including shared and embedded ones. The World Bank, Eurostat and OECD all require it.

## Effect

- Writing or reviewing Effect code (services, layers, schemas, HTTP clients, errors, tests): read `.agents/skills/effect/SKILL.md` and the references its branch chooser names. Where it disagrees with this file, this file wins. Skills live in `.agents/skills/`; `.claude/skills` is a symlink to it so Claude Code finds them too.
- Effect 4.1 docs ship in `node_modules/effect/ai-docs` and its source in `node_modules/effect/src`. Read those before guessing an API; most web examples target 3.x or 4.0 prereleases. Modules live at `effect/http`, `effect/http-api` and `effect/ai`.
- `typecheck` runs the Effect language service, and Effect warnings fail it. `allowedUnstableApis` in `tsconfig.base.json` lists the unstable modules we accept; add a module there as a deliberate choice, never to silence a diagnostic.

## Tests

- Backend tests use `@effect/vitest` and fake a service's dependencies with layers, following the Effect skill's `references/TESTING.md` (`TestService` / `testLayer`). An HTTP adapter's own tests fake its `HttpClient` layer with recorded responses.
- Server tests run inside workerd through `@cloudflare/vitest-plugin`. Its compatibility date must match the one in `packages/infra/alchemy.run.ts`.
- Frontend tests render the feature with its real providers and fake HTTP with MSW. Register handlers on `network` from `apps/web/test/network.ts`; a request no handler answers fails the test. Use same-origin URLs: happy-dom sends a CORS preflight before any cross-origin request.
- Module mocking (`vi.mock`) fails lint. Fake through layers or MSW instead.

## Cloudflare Workers

- Workers forbid timers, random values and I/O at module scope, outside a request. Build Effect runtimes and handlers on the first request, as `packages/server/src/index.ts` does.
- App code reads bindings from `cloudflare:workers` and wraps each in its own Effect layer. Only `packages/infra` imports Alchemy (lint enforces it), and `apps/web/vite.config.ts` gets no Cloudflare plugin: Alchemy adds its own at build time.

## Tooling gotchas

- pnpm refuses package versions published less than a day ago, and any dependency build script not listed under `allowBuilds` in `pnpm-workspace.yaml`. Review a build script before allowing it.
- `pnpm deploy` is a pnpm built-in. Run the infra script with `pnpm --filter @civicdata/infra run deploy`.
- Run `pnpm check` before pushing; it is the CI gate.
- Fallow enforces the package import direction (web -> server -> domain; nothing imports infra). A new package or top-level source folder needs a zone in `.fallowrc.json`, or `pnpm check` fails.

## Vendored code

- `tools/oxlint/anti-slop/` holds lint rules we own and may edit. Record every local change and upstream update in its `UPSTREAM.md`.
- `.agents/skills/effect/` is kept identical to upstream. Change it only by updating from upstream, as its `UPSTREAM.md` describes.
- `.agents/skills/fallow/` and `.agents/skills/fallow-setup/` are pointers written by `pnpm exec fallow agent install --harness codex --without guide --without mcp --without hooks`. Rerun it after upgrading `fallow`; the flags keep it from adding MCP servers, commit hooks or an `AGENTS.md` block.

## Git

- Conventional commits. The title says why the change matters; the body describes the behavior.
- Pull requests squash-merge into `main`. Each same-repo pull request deploys a `pr-<n>` preview.
