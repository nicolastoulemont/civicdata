# Stored series

World Bank charts read from our own copy of the World Development Indicators instead of asking the World Bank for each chart. A Workflow, `GatherWorkflow` (`packages/server/src/Gather.ts`), fills each stage's copy every day at 05:00 UTC. A pull request's preview has no copy or Workflow of its own: it reads production's `Series` bucket and the bookkeeping tables through `CATALOG_DB` ([docs/deploys.md](deploys.md#what-a-preview-shares-with-production)). Add the `own-catalog` label to a pull request that changes what the store holds or the gather code; its preview then gets its own empty bucket and Workflow. Deploys start no run: such a preview, or any new stage, stores nothing until its first 05:00 or a run started by hand (below), and its charts ask the World Bank until then. Eurostat and OECD charts still ask their source; they will move to the same store.

## Sources

Each source implements one contract, `Adapter` in `packages/server/src/Adapter.ts`, and nothing outside its implementation picks between sources. The `Sources` service (`Sources.ts`) holds every source's adapter by name, and a caller picks one with `sourceOf(indicator)`: the resolver and the agent's `describe_indicator` to chart and describe, the catalog build to list, the gather to store.

| Member      | Answers                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `discovery` | optional dataset dimensions, code labels, annual eligibility, countries and year bounds; unknown facts remain null |
| `policy`    | what we keep of the source's data: `Full` or `None`                                                                |
| `list`      | its catalog entries: World Bank indicators, Eurostat datasets or OECD dataflows                                    |
| `describe`  | an entry's name and definition, and the dataset a chart credits                                                    |
| `fetch`     | one series' values for some countries and years, from the source's API                                             |

A `Full` policy carries the gather's part of the contract:

| Member    | Answers                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| `changed` | the current version of every requested catalog entry in one request                             |
| `gather`  | the series of one catalog entry, in bulk, as a stream of candidates for the store sorted by key |
| `url`     | the API request that answers a query with the values a stored series holds, which a chart links |

`None` means nothing is stored and every chart asks the source. The World Bank is `Full`. Eurostat and the OECD are `None`: they implement `list`, `describe` and `fetch` from their SDMX APIs (`Sdmx.ts`), and their `changed` and `gather` come when they are mirrored. The World Bank dates one release for every indicator, so its `changed(entries)` answers an array of `{ indicator, version }` with that date for each entry. Other sources can answer a different version per entry.

`gather` answers a stream, sorted by the series' codes (`codesOf` their dimensions, compared as plain strings) with each series once, so the store packs series as they arrive and never holds an entry: the OECD's largest answer is 10 GB of CSV, and a Worker has 128 MB. The source does the sorting; SDMX-CSV answers are not grouped by series, so a source that streams one sorts it first, on disk if it must. A store that receives a series out of order fails the write. The World Bank's stream is its indicator's one series.

A series is named by its key, `SeriesKey` in `packages/domain/src/SeriesKey.ts`: an indicator and the value of each of its dimensions, none for a World Bank indicator. The store, the SDMX cache and the counterpart series that check a chart all use it.

Adding a source is one adapter and its entry in `Sources`; the type of `Sources` fails the build until every source in `Source` has one.

## What a run does

A run gathers each source whose policy is `Full`, one after the other; today that is the World Bank alone.

1. It asks the source's `changed(entries)` for each published catalog entry's current version. The World Bank answers when the World Development Indicators last changed (`/v2/sources/2`), in one request.
2. SQL compares those versions with `series_gathered`, the per-entry ledger in `CATALOG_DB`. Only entries whose stored version differs enter the worklist. An unchanged run makes the versions request and no bulk requests.
3. It takes up to 50 entries a step in code order and downloads each one's bulk file (`/v2/en/indicator/<indicator>?downloadformat=csv`) through `Pace`. Requests run one at a time so the source stops exactly at its failure limit. The CSV holds the same values as the API. The run keeps the 217 economies the app charts, leaving out regions and income groups.
4. It streams each answer into the store, then records that entry's version immediately, including when values were unchanged or held back. An entry that fails keeps its previous stored version, wanted version, reason, failure count and attempt time. Other entries continue and their records stay saved.

Five consecutive entry failures stop the source and fail the run. A success resets this streak, which steps pass along with their cursor. An isolated entry failure succeeds at the run level. If the versions request fails, the source's check fails through the Workflow step.

After three failed attempts in separate runs, an entry backs off until seven days after its last attempt. A changed wanted version bypasses that wait. Success clears the entry's failure history. A step's cursor prevents an entry that failed from being picked again in the same pass. A stopped run, including one that lost a step's result after writing, never asks again for entries the ledger already records at the wanted version. A crash between an R2 write and its ledger write can repeat that entry's fetch; the ledger cannot record a success before the store commits it.

The log counts stored, unchanged, held-back and failed entries, and reports unchanged versions and entries in backoff at the check. Each failure logs its indicator, reason and failure count. A catalog that has not published the source fails the first step and retries for about half an hour.

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

D1's `series_gathered` has primary key `(scope, indicator)`, where scope is the store layout and source, for example `series/v2/World Bank`. Its `state` is Schema-decoded JSON, a tagged union:

- `Stored`: `version` and `at` (UTC time).
- `Failed`: `wanted`, `stored` (a version or null), `failures`, `reason` and `at` (the last attempt's UTC time).

A new store layout has no ledger rows, so it gathers every entry again. Only Gather creates or changes this table. On its first build after the upgrade, it seeds every published entry covered by a legacy `series_version` row as `Stored` at that row's release, then drops `series_version`. The seed is idempotent and never overwrites a ledger decision. Legacy rows for an older layout do not seed the current layout. Entries with no legacy success row must be gathered once to establish their ledger records.

List failures with one query against the stage's catalog database:

```sql
SELECT scope, indicator,
  json_extract(state, '$.wanted') AS wanted,
  json_extract(state, '$.stored') AS stored,
  json_extract(state, '$.failures') AS failures,
  json_extract(state, '$.reason') AS reason,
  json_extract(state, '$.at') AS attempted_at
FROM series_gathered
WHERE json_extract(state, '$._tag') = 'Failed'
ORDER BY scope, indicator;
```

## Reading

One read path serves every source, `Sources.stored`. For a source whose policy is `Full` it answers a chart from the stored series, filtered to its countries and years: the explorer, `show_chart`, `find_years`, share cards and an indicator's description all go through it. The chart cites the stored series' retrieval time and links the source's request for its own countries and years (the policy's `url`), which returns the same values. A series not stored, or a bucket that fails, falls back to the source's `fetch`, through its cache: one day for the World Bank. A description reads the series without dimensions, so a source whose series have dimensions is asked for it. A source whose policy is `None` never reads the store.

`Gather` is the only writer to the store; `Store.write` applies the hold-back rule.

## Start a run by hand

Run the `Gather series` GitHub workflow with the stage, `prod` or `pr-<number>`, from the Actions tab or with `gh workflow run gather.yml -f stage=pr-123`. It refuses a pull request without the `own-catalog` label, whose preview reads production's store. It starts one instance of `civicdata-<stage>-gather`, the same as the schedule does. The Cloudflare dashboard (Workers & Pages, Workflows) starts one too. To gather again although the date has not moved, delete the relevant entries from `series_gathered` under scope `series/v2/World Bank` first.

## Identity compatibility

Adding explicit publisher ids does not change `series/v2`, the three deployed publishers' names, `pathOf`, pack prefixes or gather ledger scopes. Existing World Bank packs and `series/v2/World Bank` ledger decisions are reused, without a full refetch. New publishers' indicator keys include their name (`Publisher:native-code`), so identical native codes cannot collide across publishers. Gather discovers only registered adapters whose policy is `Full`; accepting an id never creates coverage or starts a gather for an unregistered publisher. An unregistered indicator answers `IndicatorNotFound` at chart resolution. Publisher discovery is an optional adapter capability (see [catalog.md](catalog.md#publisher-discovery)); new storage policies remain later slices.
