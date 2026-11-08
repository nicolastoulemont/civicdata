# civicdata

Ask a question about the state of a country and get a chart built from World Bank, Eurostat and OECD data, with the source of every number.

## Layout

| Path              | What it holds                                                                  |
| ----------------- | ------------------------------------------------------------------------------ |
| `apps/web`        | TanStack Start app. `src/routes/api/$.ts` hands every `/api` request to Effect |
| `packages/domain` | Schemas and the `HttpApi` definition, shared by the server and the web client  |
| `packages/server` | Effect `HttpApi` handlers, exposed as a web `handle(request)`                  |
| `packages/infra`  | Alchemy stack: the Worker, D1 and R2. The only package that imports Alchemy    |

The app deploys as one Cloudflare Worker. Alchemy builds `apps/web` with its own Cloudflare Vite plugin, so `vite.config.ts` stays free of Cloudflare code.

## Toolchain

- Node 24 and pnpm 12. The pnpm version comes from `packageManager`.
- TypeScript 7 with the Effect language service (`@effect/tsgo`). Effect diagnostics such as `floatingEffect` fail `typecheck`.
- Oxlint with type-aware rules, oxfmt, and Fallow for dead code, duplication and complexity.
- Turborepo runs `typecheck`, `test` and `build` per package.
- Vitest 5 with `@effect/vitest`. Server tests run inside workerd through `@cloudflare/vitest-plugin`, with the same compatibility date as the deployed Worker.

```sh
pnpm install
pnpm dev          # vite dev server for apps/web, no Cloudflare bindings
pnpm check        # format, lint, fallow, typecheck, test, build: what CI runs
```

`pnpm install` runs `effect-tsgo patch --typescript`, which patches TypeScript in `node_modules` so the editor loads the Effect plugin. Scripts call `effect-tsgo tsc`, so they don't depend on the patch.

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

Deploys run only after the `check` job passes. Fork pull requests run `check` without secrets and never deploy. Each stage gets its own Worker, D1 database and R2 bucket. The `prod` D1 database survives `alchemy destroy`.

### One-time setup

1. Create a Cloudflare API token for CI. Alchemy's CI guide lists Workers Scripts, Workers R2 Storage, D1 and Secrets Store write access, plus Workers Tail read. Trim it after the first deploy.
2. Bootstrap the Alchemy state store once, from a machine logged in to Cloudflare:
   ```sh
   pnpm --filter @civicdata/infra exec alchemy state bootstrap
   ```
3. In GitHub, create the `preview` and `production` environments. In each, add the secret `CLOUDFLARE_API_TOKEN` and the variable `CLOUDFLARE_ACCOUNT_ID`. Limit `production` to the `main` branch.
4. Before making the repository public:
   - Add a ruleset on `main` that requires a pull request, the `check` and `dependency-review` checks, and code owner review, and that blocks force pushes.
   - Under Actions settings, set the default `GITHUB_TOKEN` to read-only, and require approval for workflow runs from all outside collaborators.
   - Turn on secret scanning with push protection, Dependabot alerts, and private vulnerability reporting.

Alchemy is a beta that breaks things between releases. Upgrade it on a branch and let that branch's preview stage deploy before you merge. Every machine and CI job must run the same Alchemy version against the state store.
