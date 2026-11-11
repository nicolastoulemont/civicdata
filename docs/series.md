# Stored series

World Bank charts read from our own copy of the World Development Indicators instead of asking the World Bank for each chart. A Workflow, `GatherWorkflow` (`packages/server/src/Gather.ts`), fills each stage's copy every day at 05:00 UTC. A pull request's preview has no copy or Workflow of its own: it reads production's `Series` bucket and the bookkeeping tables through `CATALOG_DB` ([docs/deploys.md](deploys.md#what-a-preview-shares-with-production)). Add the `own-catalog` label to a pull request that changes what the store holds or the gather code; its preview then gets its own empty bucket and Workflow. Deploys start no run: such a preview, or any new stage, stores nothing until its first 05:00 or a run started by hand (below), and its charts ask the World Bank until then. Eurostat and OECD charts still ask their source; they remain API-backed in this change.

## Sources

Each registered publisher implements `Adapter` in `packages/server/src/Adapter.ts`. Listing and discovery describe the searchable catalog, independently of what is mirrored. `describe` supplies metadata; `fetch` supplies API observations. A file adapter's raw `fetch` should fail with `SourceUnavailable({ source, reason: "NotStored" })`; the shared read path never calls it.

The read policy has three explicit variants:

| Policy                | Read behavior                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Api`                 | Ask the API through its existing cache. Eurostat and OECD today.                                                                                                            |
| `StoredApi({ url })`  | Read the store first; on a miss or bucket failure ask the API through its existing cache. World Bank today.                                                                 |
| `StoredOnly({ url })` | Read the store. A miss fails with typed `SourceUnavailable` reason `NotStored`; bucket failure uses `StoreUnavailable`. Never call the observations API or download a file. |

`url(query, version)` receives the stored series’ actual version and links the original publisher's API request or file asset. File adapters use that version to link a pinned asset, rather than claiming the latest release is stored. Stored values retain their dataset, release and retrieval time, including when a candidate is held back or unchanged. `describe` may read metadata through the adapter when the dimensionless series is absent; file adapters must supply this from their metadata, without downloading observations. Chart reads do not start gathers or enroll work. Existing best-effort API cache writes stay unchanged.

An optional, separate `bulk` capability selects the download units:

- `changed(entries)` returns unique `{ asset, version }` pairs. `AssetId` is an opaque, nonempty, stable identifier within the source, independent of catalog entry IDs. The list may select only some units, without hiding any catalog entries or fetching all observations. No capability means no gather.
- `gather(asset, { version, entries })` fetches that unit once and emits an ordered stream of entries. Each item has `indicator` and a `series` stream. The published catalog metadata is available as `entries`, so World Bank does not need an extra metadata request per download.

World Bank uses its existing indicator string as the asset ID. A future V-Dem release can be one asset for many indicators, and a FAOSTAT domain ZIP one asset for many entries. A selected INSEE or ILO mirror uses the same contract. No such downloader is added here.

### Streaming contract

Entries strictly increase by indicator ID using plain string comparison. Each entry belongs to the current source and published catalog, and has at least one series. Each inner stream is consumed completely before the next entry is pulled. Its series strictly increase by `codesOf(dimensions)` with no duplicate key, match the entry and wanted version, and decode as `Stored`. Empty assets, empty entry streams, malformed candidates, wrong versions, foreign entries and out-of-order output fail the asset. The store retains its hashing and hold-back rules.

Each candidate is a complete replacement for its series' country-year observations, not a patch of selected countries or years. WID's country files therefore cannot feed the store directly as independent replacements for one cross-country series: the hold-back rule would treat the other countries as lost. Before that integration, partitioned ingestion must assemble complete series while retaining each input's version and retrieval provenance. Asset download checkpoints and coherent publication of assembled series remain separate requirements; this PR does not implement that assembly.

Producers must use backpressure and bounded chunks. They may share one file cursor between the outer and inner streams, since the consumer does not pull them concurrently. A source whose file interleaves entries must sort on disk in a local runner before streaming, rather than collect the archive or an entry in Worker memory. The store holds one existing pack and one pack under construction, plus pack manifests; one complete series' observations and manifest size remain memory limits. This contract does not make arbitrary archives safe to parse inside Workers.

## What a run does

A run visits registered sources with `bulk` capabilities. It checks versions once, compares the selected assets with `asset_gathered`, and takes up to 50 wanted assets per step in ID order. A successful unchanged run makes no bulk request. Each asset's entries are persisted sequentially; only after the entire outer stream and every store write finish does the ledger record its version. Held candidates count as consumed, not as an activated release: the actual stored series keeps its prior provenance.

A failed stream or store write leaves that asset failed with its previous completed version, wanted version, reason, failure count and attempt time. Other successful units stay complete. Five consecutive asset failures stop the source and fail the run; success resets the streak. A cursor prevents another attempt in the same run. After three separate-run failures an asset waits seven days from the last attempt, unless its wanted version changes. A version check failure still fails the source's Workflow step.

There is no transaction between R2 and the progress database. A crash after an entry commit, or after the last store commit but before the ledger commit, can repeat that asset's fetch and writes. Hashing reuses unchanged stored values on retry. Earlier entries of a failed asset may already be visible. **Atomic release activation across entries is deferred and required before V-Dem integration.** A missing entry is never taken as evidence of success merely because old values exist.

`Gather.run()` contains the domain loop for both scheduled Workflows and local first fills. Workflows provide `Step.workflow`. A local runner provides `Step.immediate`, `Gather.layer`, a local SQL client over the same progress schema, `Store.r2(bucket)` and registered source layers. The fixture tests run that path in-process. A future operational local runner must supply the bucket/database transports and file sorting; there is no second script ledger or production fill in this change.

## The store

The stage's `Series` R2 bucket holds each catalog entry's series in packs. A pack is one JSON object of about 1 MB that holds many series of one entry, sorted by their codes, and cut by size, so the layout is the same for every source and a chart's series is in one pack. Callers read and write by series key and know nothing about packs.

Each entry has one object, at `series/v2/<source>/<indicator>`. `<source>` is the source's name in lower case, words joined by `-`, so a World Bank indicator lives at `series/v2/world-bank/<indicator>`. The object holds one of two things:

- A pack, when the entry's series fit one. A chart then costs one read. Every World Bank indicator is one series, so it is one pack.
- An index, when they do not: the first codes and the hash of each pack, in order. Each pack lives at `series/v2/<source>/<indicator>/<hash>`. A chart reads the index, finds the last pack whose first codes come at or before the series' codes, and reads that pack: two reads. The index never lists series, only packs: for the OECD's System of Health Accounts (`DF_SHA`, 48,708 series) it is 159 KB with 636 entries.

A pack holds the entry's indicator (name and definition) and dataset once, then each series as `[codes, hash, series]`: its codes, the SHA-256 of its values, and the series itself with its dimensions, the release date it came from, when it was fetched, and every observation, sorted by country and year. A reader parses the pack with `JSON.parse`, binary-searches the codes, and decodes only that series with Schema, so every charted value is still decoded first. Packs are stored as plain JSON: on `DF_SHA`, gzip cut a pack from 999 KB to 131 KB but added 1.1 ms of CPU to a 4.5 ms read, and the bytes cost nothing that matters.

A change to what an object holds bumps `v2`, so no reader decodes an object of another format; a reader that meets one anyway treats the series as not stored. `v1` held one object per series and is no longer read.

The bucket is separate from `Cache`: the cache holds answers that can expire and are refetched, while a stored series stays until its source publishes a change, and the bucket's own size and write counts are the store's.

## Writing

`Store.write` takes an entry's candidates as a stream and merges them into its packs as they arrive, holding one stored pack and the pack it is filling at a time. It answers what it did with each candidate: stored, unchanged or held back.

- A stored pack whose range of codes no candidate falls in is kept, unread. A series the stream leaves out keeps its stored values, so a source can send only what changed.
- A candidate whose values hash the same as the stored series' keeps the stored series as it is, with its original release date and retrieval time.
- The packs of a range a candidate falls in are cut again from the range's first codes, so the same series give the same packs and the same hashes. A pack whose hash is already stored costs no write: an unchanged gather of `DF_SHA` reads its 637 objects and writes none. A changed pack is written at its new hash, then the index, then the packs it no longer lists are deleted. A range that outgrows 1 MB splits; packs never merge.
- A write that fails before its index is stored deletes the packs it wrote, so readers keep reading the previous index.

## Holding back a candidate

The hold-back rule applies per series, inside the pack. When a candidate's hash differs from the stored series', the write decodes the stored series and compares:

- An empty answer, or one that lacks a country-year the stored series has, is held back. The stored series keeps serving from the rewritten pack while its neighbours update, and the run records the candidate in D1's `series_held`: the series key as `pathOf` writes it, `Empty` or `Lost`, the lost country-years as JSON, the release and the retrieval time.
- Otherwise the answer replaces the stored series. Sources revise values, sometimes by a lot, and nobody reviews each release; added countries or years are welcome.

A held-back series' row goes once a later answer replaces the stored series or matches it again. The World Bank answering that it no longer knows an indicator counts as an empty answer.

D1's `asset_gathered` has primary key `(scope, asset)`. Scope remains the store layout and publisher, for example `series/v2/World Bank`. State is Schema-decoded JSON:

- `Stored`: `version` and UTC `at`, meaning the asset output was consumed successfully.
- `Failed`: `wanted`, previous completed `stored` version or null, `failures`, `reason` and last attempt's UTC `at`.

Initialization bridges deployed World Bank `series_gathered(scope, indicator, state)` rows using `INSERT OR IGNORE`, copying the indicator as asset and JSON state verbatim. Stored versions, failure reasons, counts and weekly backoff survive. Both `series/v1/World Bank` and `series/v2/World Bank` keep their scopes: a v1 success never completes v2. Existing asset rows win if initialization repeats or stops after copying. The old table is retained read-only for the bridge. The earlier `series_version` migration still seeds only published entries under the current layout, then drops that older table. No migration reads R2 to infer success.

To inspect failures, query `asset_gathered` by scope and asset, extracting `$.wanted`, `$.stored`, `$.failures`, `$.reason` and `$.at` from state where `$._tag = 'Failed'`.

## Reading

`Sources.stored` serves the explorer, chart tools, year searches, shares and descriptions. It filters observations to the requested countries and years, preserves attribution and retrieval time, and applies the read policy above. The agent distinguishes not-yet-stored series from an upstream outage. No share IDs, catalog/vector fingerprints, store object paths or API cache keys change.

## Start a run by hand

Run the `Gather series` GitHub workflow with the stage, `prod` or `pr-<number>`, from the Actions tab or with `gh workflow run gather.yml -f stage=pr-123`. It refuses a pull request without the `own-catalog` label, whose preview reads production's store. It starts one instance of `civicdata-<stage>-gather`, the same as the schedule does. The Cloudflare dashboard (Workers & Pages, Workflows) starts one too. To gather again although the date has not moved, remove the relevant `asset_gathered` rows and any corresponding retained legacy `series_gathered` rows under that scope first; otherwise the bridge will seed them again. This is an administrative operation, not a chart-read behavior.

## Identity compatibility

Adding explicit publisher ids does not change `series/v2`, the three deployed publishers' names, `pathOf`, pack prefixes or gather ledger scopes. Existing World Bank packs and `series/v2/World Bank` ledger decisions are reused, without a full refetch. New publishers' indicator keys include their name (`Publisher:native-code`), so identical native codes cannot collide across publishers. Gather discovers only registered adapters with a `bulk` capability; accepting an id never creates coverage or starts a gather for an unregistered publisher. An unregistered indicator answers `IndicatorNotFound` at chart resolution. Publisher discovery is an optional adapter capability (see [catalog.md](catalog.md#publisher-discovery)); coherent observation publication is described below; real source adapters, forecast/uncertainty/quality schemas and production fills remain separate work.

## Coherent releases

A source that re-estimates history across indicators can opt in with
`bulk.release(entries)`. It returns a decoded `Release`: a source version, a
nonnegative integer `order` assigned from the publisher's release chronology,
and every required asset with its complete list of series keys (indicator and
dimensions). Version strings are opaque. An order must identify one immutable
release; corrections require a higher order. Coherent sources use `StoredOnly`.
`changed` remains the incremental contract and is not called for these sources.
No deployed adapter opts in in this PR.

`Gather.run` uses the same publication path with `Step.workflow` and
`Step.immediate`. Each asset streams through the existing Store packer into a
release namespace. Candidates must match the declared version, source and exact
membership. Empty streams, omitted or extra keys, duplicate keys, held candidates
and failed writes cannot complete an asset. Completion is recorded in
`asset_gathered` under a namespace-specific scope after the whole asset persists.
A retry skips those completed assets; if only activation failed, it downloads
nothing. A failed asset may leave staged packs, but no chart reads them.
Failed assets retain their reason and failure count in the same ledger. After
three failed runs, that asset waits seven days; a new release bypasses the wait.
Other eligible assets still stage, until five consecutive attempts fail. A
backed-off or failed required asset prevents activation without discarding the
other assets' completed progress.

Hold-back compares every candidate against the previous active release, including
its country-years. Empty or lossy candidates still enter `series_held` and reject
the release. An omitted series or dimension is rejected too. There is currently
no removal override. A source wishing to remove data needs a separate reviewed
policy, rather than treating omission or hold-back as a coherent new release.
Staging never copies a held old series beside accepted new members.

After all required asset completion records exist, a single conditional SQL write
publishes the decoded manifest in `series_release`. It requires a higher order
and the same base release used for hold-back checks. Concurrent activation of a
different release rejects the stale attempt; a later run stages against the new
base. Older and equal orders do not replace an active release. SQL failure leaves
the old pointer readable. First fill answers `NotStored` until activation.

The manifest points to immutable R2 objects under `releases/<fingerprint>/`.
Writes use R2 create-only conditions; conflicting content fails instead of
rewriting an active or pinned release. Retried writes with identical content are
idempotent. This transport contract also applies to later local bucket adapters.
There is no retention job: previous releases and abandoned packs remain stored.
Any future cleanup must account for active and pinned reads.

`Sources.stored` exposes a snapshot for coherent sources. `Resolver.resolve`
pins snapshots before reading metadata, relation operands, transforms or
counterparts. All entries from one publisher in that operation use one manifest,
even when the pointer changes. Independent fetch calls are separate operations;
other multi-entry consumers must use `Sources.pin` once for their operation.
Stored URLs use each value's stored version and retrieval time. A missing table
or first release does not download an archive; malformed manifests and store
failures produce typed `SourceUnavailable` outcomes. Readers never create tables.

The writer creates one new pointer table when a coherent gather runs. Existing
`series/v2` paths, hashes, World Bank progress/migration/backoff and API caches
are unchanged. Incremental sources still commit entries as they arrive. There
is no production migration, fill or gather required by this change. Its preview
requires `own-catalog` and uses isolated resources.

For V-Dem, register a stored-only adapter whose release metadata declares the
full indicator/dimension membership and chronological release order, and whose
asset streams yield complete series with that version and real retrieval times.
Catalog discovery stays separate. This foundation supplies no downloader or
local bucket/database transport. WID country files still need explicit assembly
into whole country-year series and per-input provenance before ingestion. This
PR does not solve WID assembly or forecast, uncertainty and quality semantics,
and adds none of the seven planned source adapters or changes to their terms.

## INSEE API reads

INSEE uses `Api`, without a bulk capability or gather enrollment. Melodi's catalog
publishes `modified` dates and ZIP CSV products, but this slice downloads neither
a full mirror nor a production fill. The existing API cache keeps descriptions
and complete query answers for one day, retaining retrieval times and serving an
old successful answer if a refresh fails. Metadata/range memoization lasts one day.
Pace budgets `api.insee.fr` at 25 requests/minute, below the documented anonymous
30/minute limit, with a minute cooldown after 429.

Data requests fix FREQ=A, every selected series dimension and an explicit
`page=1`, plus the requested date bounds. Pagination follows the publisher's next
links only on the same dataset endpoint; absent continuation, cycles, failed
pages and duplicate country-years fail the whole read. Recorded fixtures use a
page size of one to exercise continuation. Monthly periods and non-national
geographies cannot become country-year observations. Unrecognized dimensions,
statuses, confidentiality states or unit multipliers fail rather than guess.
The one dataset uses `OBS_VALUE_NIVEAU`. `UNIT_MULT` 0, 3 and 6 multiply fetched
values into base units, while `UNIT_MEASURE` stays in the visible series choices.
P becomes Provisional; A remains unflagged. L and M are missing, never zero.
Reference-price years are filtered exactly, including null, before duplicate
checks. No annualization, aggregation, interpolation or source pairing occurs.

Every resolved chart carries INSEE, the dataset, `Source: Insee`, the catalog's
last-update timestamp, the exact first-page API URL and the observation retrieval
time. The common chart attribution also covers shares and embeds. The terms are
[Open Licence 2.0](https://www.insee.fr/fr/information/2008466), confirmed in Melodi's
OpenAPI; they require source and known last-update credit.

The preview requires `own-catalog`. Its normal catalog build discovers this entry
in isolated resources. No manual production catalog build, gather or fill is
part of this integration; each needs the owner's explanation and approval first.
