# Deploys

| Trigger                     | Stage              | GitHub environment |
| --------------------------- | ------------------ | ------------------ |
| Pull request from this repo | `pr-<n>`           | `preview`          |
| Pull request closed         | `pr-<n>` destroyed | `preview`          |
| Push to `main`              | `prod`             | `production`       |

Deploys run only after the `check` job passes. Fork pull requests run `check` without secrets and never deploy. Each stage gets its own Worker, D1 database, `Cache` and `Series` R2 buckets and conversation Durable Objects. The `prod` D1 database survives `alchemy destroy`.

R2 refuses to delete a bucket that holds objects. Every stage but `prod` sets `forceDestroy` on its two buckets, so `alchemy destroy` empties them first; on `prod` the destroy fails instead. A destroy reads `forceDestroy` from the stage's last deploy, not from the code it runs.

## Removing a preview the cleanup left behind

If the `cleanup` job fails, the closed pull request's comment says "Failed" and its stage keeps whatever the destroy could not delete. Run the Remove previews workflow from `main` with the pull request numbers:

```sh
gh workflow run remove.yml -f prs="100 109"
```

It refuses an open pull request. For each stage, it deploys only the two buckets, which records `forceDestroy` on a stage last deployed without it, then destroys the stage. Its last step lists every `civicdata-` bucket left in the account and fails if one belongs to a closed pull request.

## One-time setup

1. Create a Cloudflare API token for CI. Alchemy's CI guide lists Workers Scripts, Workers R2 Storage, D1 and Secrets Store write access, plus Workers Tail read. Add Vectorize write access for the catalog's index. Trim it after the first deploy.
2. Bootstrap the Alchemy state store once, from a machine logged in to Cloudflare:
   ```sh
   pnpm --filter @civicdata/infra exec alchemy state bootstrap
   ```
3. In GitHub, create the `preview` and `production` environments. In each, add the secrets `CLOUDFLARE_API_TOKEN` and `OPENAI_API_KEY` and the variable `CLOUDFLARE_ACCOUNT_ID`. To record traces, also add the variable `OTEL_EXPORTER_OTLP_ENDPOINT` and the secret `OTEL_EXPORTER_OTLP_HEADERS` ([docs/traces.md](traces.md#grafana-cloud)). Limit `production` to the `main` branch. Fund the OpenAI project behind the key with prepaid credits and cap their auto-reload: that is the only limit on total spend. Each Worker limits one visitor to five questions a minute, and once the credits run out every question answers "The assistant is not available".
4. Protect the repository. Rulesets, dependency review, code scanning uploads and private vulnerability reporting need a public repository on GitHub's free plan. This repository has:
   - A `main` ruleset: pull request required, the `check` and `dependency-review` checks must pass (from GitHub Actions only), CodeQL and zizmor report no high alerts, squash merges only, linear history, and no force pushes or deletion. It requires no approvals while there is one maintainer, because GitHub doesn't let you approve your own pull request. It has no bypass actors, since agents merge with the maintainer's token.
   - Branches need not be up to date with `main` to merge, and auto-merge is on: `gh pr merge --auto --squash` lands a pull request once its checks pass. Two pull requests that pass alone can still break together; `check` runs again on the push to `main` and `prod` deploys only if it passes.
   - A read-only default `GITHUB_TOKEN`, every action pinned to a full commit SHA (enforced in the Actions settings), and approval required for workflow runs from all outside contributors.
   - Secret scanning with push protection, Dependabot alerts, and private vulnerability reporting.

## Your own stage

To deploy your own stage from your machine, connect Cloudflare once with `pnpm --filter @civicdata/infra exec alchemy profile edit`, then run `pnpm --filter @civicdata/infra run deploy`. Keep the `run`: without it, pnpm runs its own `deploy` command instead of the script. The stage is named `live_<your user>` unless you pass `--stage`.

## Upgrading Alchemy

Alchemy is a beta that breaks things between releases. Upgrade it on a branch and let that branch's preview stage deploy before you merge. Every machine and CI job must run the same Alchemy version against the state store.
