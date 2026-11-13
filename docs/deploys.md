# Deploys

| Trigger                     | Stage              | GitHub environment |
| --------------------------- | ------------------ | ------------------ |
| Pull request from this repo | `pr-<n>`           | `preview`          |
| Pull request closed         | `pr-<n>` destroyed | `preview`          |
| Push to `main`              | `prod`             | `production`       |

Deploys run only after the `check` job passes. Fork pull requests run `check` without secrets and never deploy. Each stage gets its own Worker, D1 database, `Cache` bucket, conversation Durable Objects and pacing. The `prod` D1 database survives `alchemy destroy`.

Only `prod` runs Workflows on a schedule. Pacing is per stage (`packages/server/src/Pace.ts`), so every stage that gathered on its own schedule would add a full stage's requests against the World Bank and the other publishers.

A stage that owns its catalog and paper store binds four Workflows:

| Workflow       | Class                 | Writes                                               | Starts                                                                                        |
| -------------- | --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `PAPER_GATHER` | `PaperGatherWorkflow` | gathered papers, the gather's ledger and run records | by hand ([papers](papers.md#start-a-gather-by-hand)), and in `prod` every Monday at 03:00 UTC |
| `CATALOG`      | `CatalogWorkflow`     | the catalog, political records and directions        | after each deploy, and in `prod` every Monday at 04:00 UTC                                    |
| `GATHER`       | `GatherWorkflow`      | the stored series                                    | by hand ([series](series.md#start-a-run-by-hand)), and in `prod` daily at 05:00 UTC           |
| `ANNOTATE`     | `AnnotateWorkflow`    | paper annotations and their keys' states             | by hand ([papers](papers.md#start-a-run-by-hand)), and in `prod` daily at 06:00 UTC           |

### Closing a pull request

The `cleanup` job destroys the stage when the pull request closes. `alchemy destroy` deletes what the stage's state lists: the Worker with its Durable Objects and custom domain, the Workflows, the D1 database, both buckets and the index. A pull request merged while its last push's `check` still runs closes before that push's preview deploys: `cleanup` finds an empty state and deletes nothing, then the `preview` job would deploy a stage nothing removes. So the `preview` job reads the pull request when it starts and, once it has closed, destroys the stage instead of deploying it, and the comment says "Removed". Both jobs share the `deploy-pr-<n>` concurrency group, so whichever runs last sees the closed pull request.

## Domains

Production serves `https://openfacts.app`. Each `pr-<n>` stage serves
`https://preview.<n>.openfacts.app`; for example, PR 123 serves
`https://preview.123.openfacts.app`. Other stages keep their `workers.dev` URL.
The preview comment reads the URL from Alchemy's stack output.

Alchemy attaches each hostname as a Worker custom domain in the existing
`openfacts.app` zone, which must be active in the same Cloudflare account as the
Workers. Cloudflare creates its DNS record and HTTPS certificate, including for
the nested preview hostname, without a separate Advanced Certificate Manager
subscription. Do not add a CNAME for these hostnames: an existing CNAME prevents
Cloudflare from attaching a custom domain.

The tokens in both GitHub environments need Zone Read access for `openfacts.app`
and Account Workers Scripts Edit access for the custom-domain API, in addition to
the deployment permissions below. Closing a pull request destroys its stage and
removes its custom-domain attachment. Cloudflare keeps the issued certificate
after the attachment is removed; unused certificates can be deleted from
SSL/TLS > Edge Certificates.

References: [Alchemy custom domains](https://alchemy.run/cloudflare/networking/custom-domains/)
and [Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Bot protection

Cloudflare's HTTP DDoS protection is always enabled for the custom domains.
Turnstile also checks each browser before it can ask a question or have a chart
explained, since each one starts a model request. Browsing charts, reading
answers, and stopping an answer need no challenge. Once the app loads, it calls
`POST /api/verification`. A browser without a pass gets `VerificationRequired`,
runs Turnstile hidden (`interaction-only`) and sends its proof. If Cloudflare
wants the person to interact, the hidden check gives up, and the first question
or explanation that browser sends gets `VerificationRequired` and opens the
challenge in a dialog. Proofs are single-use and expire after five minutes. The
server checks the proof's action and exact hostname, rejects the request if
verification fails or Cloudflare cannot be reached, and otherwise sets a pass:
the `__Host-verified` session cookie (HttpOnly, Secure, SameSite=Strict),
holding its expiry signed with HMAC-SHA256 under the Turnstile secret. Requests
from that browser pass without a proof until the session ends or 24 hours have
gone by, whichever comes first. Rotating the secret voids every pass.

The managed `openfacts` Turnstile widget allows `openfacts.app`, which also covers
its preview subdomains. Both GitHub environments have the public variable
`TURNSTILE_SITE_KEY` and secret `TURNSTILE_SECRET_KEY`. CI passes them to Alchemy;
only the site key enters the browser bundle. The CI API tokens need no Turnstile
permissions: widget management is separate from deployment. Local development
without these bindings skips the check. Production and PR stages fail closed
when their secret is missing.

References: [DDoS defaults](https://developers.cloudflare.com/ddos-protection/managed-rulesets/http/)
and [Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## What a preview shares with production

A pull request's preview reads production's catalog, stored series and papers: the catalog's D1 tables (the catalog, the political records, the directions and the series' bookkeeping), the `Vectors` index, the `Series` bucket, and the paper store: the `PapersDatabase` database and `Papers` bucket ([papers](papers.md)). Its search answers on its first request and its World Bank charts read the store, with no build of its own. It deploys no Catalog, Gather, PaperGather or Annotate Workflow, and CI starts no catalog build for it.

The Worker reads the catalog's tables through the `CATALOG_DB` binding, and binds `DB` to the stage's own database for anything a request writes. Everywhere else both bindings name the stage's own database. Requests only read what `CATALOG_DB`, `VECTORS`, `SERIES`, `PAPERS_DB` and `PAPERS` bind: readers never create, alter or drop a table (`packages/server/src/built.ts`), and a reader that meets a missing table answers "unavailable". Only the Workflows write, and a build stops before writing in a Worker that binds no Workflow (`database` in `packages/server/src/CatalogBuild.ts`). D1 has no read-only binding, so that code path is the protection.

`packages/infra/alchemy.run.ts` binds production's resources with `Resource.ref(id, { stage: "prod" })`. A ref is not a resource of the preview's stack: a deploy reads the target's id from production's state and puts it in the Worker's bindings, and the target never enters the preview's state. `alchemy destroy` deletes only what the stage's own state lists, so the `cleanup` job and the Remove previews workflow never reach production's databases, index or buckets, and `forceDestroy` applies only to the preview's own buckets.

### The `own-catalog` label

Add the `own-catalog` label to a pull request that changes what the catalog or the store holds or how either is built: a table's shape, the embedding model, the catalog, politics or gather build code, or the paper store's tables. Without it the preview reads production data that does not match its code: its search fails or returns wrong results, and production is unaffected.

With the label, the preview gets its own catalog database binding, `Vectors` index, `Series` bucket, `PapersDatabase` database, `Papers` bucket and Workflows, and CI starts a catalog build after each deploy, as every preview did before. Its Workflows have no schedule: the catalog builds once per deploy, and the series gather only when someone starts a run with the [Gather series](series.md#start-a-run-by-hand) workflow, so a pull request that changes gather code runs it against its own empty store on demand. The preview keeps both Workflows because a Workflow is the only code that writes its tables and bucket, and a build refuses to run in a Worker that binds only one of them (`database` in `packages/server/src/CatalogBuild.ts`). CI runs on `labeled` and `unlabeled`: adding the label redeploys the preview with its own resources and starts a build, and removing it points the preview back at production and deletes its own index, buckets, papers database and Workflows. The preview job reads the label when it deploys, not from the event, and passes `OWN_CATALOG` to the stack, which decides from it and the stage: only a `pr-<n>` stage without the label shares, and so does `alchemy dev` unless `OWN_CATALOG=true`. Production and a stage deployed by hand keep their own.

R2 refuses to delete a bucket that holds objects. Every stage but `prod` sets `forceDestroy` on its buckets, so `alchemy destroy` empties them first; on `prod` the destroy fails instead. A destroy reads `forceDestroy` from the stage's last deploy, not from the code it runs.

## Map archive

Map source snapshots and licensed downloads belong to `packages/infra/maps.run.ts`,
a separate `openfacts-maps` stack with the fixed `archive` stage. The bucket is
retained, force deletion is disabled, and app preview cleanup does not own it.
Its custom domain is `maps.openfacts.app`; the rate-limited `r2.dev` endpoint stays
disabled. Deploy it with `pnpm --filter @repo/infra run deploy:maps`.

Map objects use SHA-256 keys. The committed manifest pins each object's byte
length and checksum; publishing reads each object back before success. Ordinary
web builds and checks need neither R2 credentials nor archive downloads. Boundary
links redirect to the pinned public objects. See the
[map archive workflow](../packages/maps/README.md).

## Eval archive

The private `civicdata-evals` bucket belongs to `packages/infra/evals.run.ts`, a separate stack deployed by `deploy:evals` with the fixed `archive` stage. Its removal policy retains the bucket, and force deletion is disabled. Preview deploys and cleanup do not own it. [Eval archive operations](evals.md#pack-upload-and-restore) cover transfers and verification.

## Removing a preview the cleanup left behind

If the `cleanup` job fails, the closed pull request's comment says "Failed" and its stage keeps whatever the destroy could not delete. Run the Remove previews workflow from `main` with the pull request numbers:

```sh
gh workflow run remove.yml -f prs="100 109"
```

It refuses an open pull request and destroys each stage. Its last step lists the account's Workers, Workflows, D1 databases, R2 buckets and Vectorize indexes, and fails if one's name carries `-pr-<n>-` for a closed pull request.

A destroy reads the state store, never the stack's code, so a stage whose state is empty but whose resources exist (one whose state someone deleted) needs them deleted through the Cloudflare API or dashboard. Every resource's name carries its stage.

## One-time setup

1. Create a Cloudflare API token for CI. Alchemy's CI guide lists Workers Scripts, Workers R2 Storage, D1 and Secrets Store write access, plus Workers Tail read. Add Vectorize write access for the catalog's index. Trim it after the first deploy.
2. Bootstrap the Alchemy state store once, from a machine logged in to Cloudflare:
   ```sh
   pnpm --filter @repo/infra exec alchemy state bootstrap
   ```
3. In GitHub, create the `preview` and `production` environments. In each, add the secrets `CLOUDFLARE_API_TOKEN`, `OPENAI_API_KEY` and `OPENALEX_API_KEY` ([papers](papers.md#openalex-key)) and the variable `CLOUDFLARE_ACCOUNT_ID`. To record traces, also add the variable `OTEL_EXPORTER_OTLP_ENDPOINT` and the secret `OTEL_EXPORTER_OTLP_HEADERS` ([docs/traces.md](traces.md#grafana-cloud)). Limit `production` to the `main` branch. Fund the OpenAI project behind the key with prepaid credits and cap their auto-reload: that is the only limit on total spend. Each Worker limits one visitor to five questions a minute, and once the credits run out every question answers "The assistant is not available".
4. Protect the repository. Rulesets, dependency review, code scanning uploads and private vulnerability reporting need a public repository on GitHub's free plan. This repository has:
   - A `main` ruleset: pull request required, the `check` and `dependency-review` checks must pass (from GitHub Actions only), CodeQL and zizmor report no high alerts, squash merges only, linear history, and no force pushes or deletion. It requires no approvals while there is one maintainer, because GitHub doesn't let you approve your own pull request. It has no bypass actors, since agents merge with the maintainer's token.
   - Branches need not be up to date with `main` to merge, and auto-merge is on: `gh pr merge --auto --squash` lands a pull request once its checks pass. Two pull requests that pass alone can still break together; `check` runs again on the push to `main` and `prod` deploys only if it passes.
   - A read-only default `GITHUB_TOKEN`, every action pinned to a full commit SHA (enforced in the Actions settings), and approval required for workflow runs from all outside contributors.
   - Secret scanning with push protection, Dependabot alerts, and private vulnerability reporting.

## Your own stage

To deploy your own stage from your machine, connect Cloudflare once with `pnpm --filter @repo/infra exec alchemy profile edit`, then run `pnpm --filter @repo/infra run deploy`. Keep the `run`: without it, pnpm runs its own `deploy` command instead of the script. The stage is named `live_<your user>` unless you pass `--stage`.

## Upgrading Alchemy

Alchemy is a beta that breaks things between releases. Upgrade it on a branch and let that branch's preview stage deploy before you merge. Every machine and CI job must run the same Alchemy version against the state store.

Gather changes use `own-catalog` too: the asset progress schema initializes on the preview’s own database when a gather starts. Deploying does not migrate or fill production. Workflow and local ingestion share `Gather.layer` and its progress logic; local transports remain separate work; coherent source opt-in publication stages immutable packs and conditionally updates its own pointer table ([series.md](series.md#coherent-releases)).

## FAOSTAT ASTI expenditures

Only `FAOSTAT:AE` measure 8006 (agricultural R&D expenditure as a percentage of
agricultural value added) is registered. Measure, cost category and institution
are explicit dimensions; the other four measures and all other domains remain
unlisted. Discovery uses the official bulk manifest and reviewed local labels,
independently of stored availability. Chart requests use StoredOnly. Only the
manual Node command enrolls the AE archive with shared Gather/Store and real
D1/R2 transport, disk sorting, complete series and manifest rechecking. FAO's
raw flags, notes and missing numbers use a source-specific qualification variant
without an ILO survey. Existing ILO payloads remain valid.

This change requires `own-catalog`. No manual production/preview fill or catalog
build is part of delivery. Stored data needs an explained, owner-approved fill.
[Coverage, exclusions, terms, evidence and operator prerequisites](research/faostat/README.md)
record the exact limits and annual financial-year convention.

## V-Dem electoral democracy

Only `V-Dem:v2x_polyarchy`, France and Sweden in 1991–2025, is admitted from
the pinned V16 official R package asset. Local discovery describes the reviewed
70 country-years; stored coverage reads establish availability. Publisher
estimates and 68% HPD bounds remain together through typed qualifications,
hashes, range filters, resolver/tools and visible restored/shared/embedded chart
evidence. Qualified transforms remain rejected. Coherent release order 16,
complete membership, immutable staging and reader pinning use the shared release
contract. RData parsing runs only in the operational Node fill command; chart
misses return `NotStored` with no archive request.

The preview requires `own-catalog`. No manual production/preview fill, gather or
catalog build ran; each operation needs an explained, owner-approved target.
[Evidence, exclusions, terms and the operational first-fill path](research/vdem/README.md)
state the narrow scope. NTO-219 remains in progress for the remaining sources.
