# Stored series

World Bank charts read from our own copy of the World Development Indicators instead of asking the World Bank for each chart. A Workflow, `GatherWorkflow` (`packages/server/src/Gather.ts`), fills each stage's copy every day at 05:00 UTC. A pull request's preview has no copy or Workflow of its own: it reads production's `Series` bucket and the bookkeeping tables through `CATALOG_DB` ([docs/deploys.md](deploys.md#what-a-preview-shares-with-production)). Add the `own-catalog` label to a pull request that changes what the store holds or the gather code; its preview then gets its own empty bucket and Workflow. Deploys start no run: such a preview, or any new stage, stores nothing until its first 05:00 or a run started by hand (below), and its charts ask the World Bank until then. Eurostat and OECD charts still ask their source; they will move to the same store.

## Sources

Each source implements one contract, `Adapter` in `packages/server/src/Adapter.ts`, and nothing outside its implementation picks between sources. The `Sources` service (`Sources.ts`) holds every source's adapter by name, and a caller picks one with `sourceOf(indicator)`: the resolver and the agent's `describe_indicator` to chart and describe, the catalog build to list, the gather to store.

| Member     | Answers                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `policy`   | what we keep of the source's data: `Full` or `None`                             |
| `list`     | its catalog entries: World Bank indicators, Eurostat datasets or OECD dataflows |
| `describe` | an entry's name and definition, and the dataset a chart credits                 |
| `fetch`    | one series' values for some countries and years, from the source's API          |

A `Full` policy carries the gather's part of the contract:

| Member    | Answers                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------- |
| `changed` | the release to gather, or none when the release the last complete run recorded is still the latest |
| `gather`  | the series of one catalog entry, in bulk, as a stream of candidates for the store sorted by key    |
| `url`     | the API request that answers a query with the values a stored series holds, which a chart links    |

`None` means nothing is stored and every chart asks the source. The World Bank is `Full`. Eurostat and the OECD are `None`: they implement `list`, `describe` and `fetch` from their SDMX APIs (`Sdmx.ts`), and their `changed` and `gather` come when they are mirrored. The World Bank dates one release for every indicator, so its `changed` answers for all of them or none.

`gather` answers a stream, sorted by the series' codes (`codesOf` their dimensions, compared as plain strings) with each series once, so the store packs series as they arrive and never holds an entry: the OECD's largest answer is 10 GB of CSV, and a Worker has 128 MB. The source does the sorting; SDMX-CSV answers are not grouped by series, so a source that streams one sorts it first, on disk if it must. A store that receives a series out of order fails the write. The World Bank's stream is its indicator's one series.

A series is named by its key, `SeriesKey` in `packages/domain/src/SeriesKey.ts`: an indicator and the value of each of its dimensions, none for a World Bank indicator. The store, the SDMX cache and the counterpart series that check a chart all use it.

Adding a source is one adapter and its entry in `Sources`; the type of `Sources` fails the build until every source in `Source` has one.

## What a run does

A run gathers each source whose policy is `Full`, one after the other; today that is the World Bank alone.

1. It asks the source's `changed` what to gather. The World Bank answers when the World Development Indicators last changed (`/v2/sources/2`). When that date equals the one the last complete run recorded, the run stops there: one request, no writes.
2. Otherwise it takes the source's entries in the published catalog, 50 a step in code order, and downloads each one's bulk file (`/v2/en/indicator/<indicator>?downloadformat=csv`), two at a time, through `Pace`. The file is a ZIP of about 50 KB whose CSV holds every economy and year since 1960, and the World Bank serves it in about a tenth of a second. The API's own query for every country and year answers about 3 MB and, for an indicator nobody asked for lately, takes from seconds to several minutes: in the first preview run 8% of those queries timed out. The CSV holds the same values as the API. The run keeps the 217 economies the app charts, so the World Bank's regions and income groups never reach the store; no chart showed them before either.
3. It streams each answer into the store (below), then records the date once every indicator is stored, unchanged or held back. If an indicator failed, the date stays unrecorded and the run fails, so the next run asks for every indicator again; the ones that did not change write nothing.

A step saves the last indicator it gathered and its counts. A run that stops part way resumes after the last step that completed. A run that finds no World Bank entries in the catalog fails its first step and retries for about half an hour, in case a catalog build is still publishing them.

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

D1's `series_version` holds the release each scope was last gathered from in full, under the store's layout: `series/v2/World Bank` for now, one row per Eurostat dataset later. A bump of the layout's version therefore gathers every series again on the next run, whether or not the source published a new release.

## Reading

One read path serves every source, `Sources.stored`. For a source whose policy is `Full` it answers a chart from the stored series, filtered to its countries and years: the explorer, `show_chart`, `find_years`, share cards and an indicator's description all go through it. The chart cites the stored series' retrieval time and links the source's request for its own countries and years (the policy's `url`), which returns the same values. A series not stored, or a bucket that fails, falls back to the source's `fetch`, through its cache: one day for the World Bank. A description reads the series without dimensions, so a source whose series have dimensions is asked for it. A source whose policy is `None` never reads the store.

`Gather` is the only writer to the store; `Store.write` applies the hold-back rule.

## Start a run by hand

Run the `Gather series` GitHub workflow with the stage, `prod` or `pr-<number>`, from the Actions tab or with `gh workflow run gather.yml -f stage=pr-123`. It refuses a pull request without the `own-catalog` label, whose preview reads production's store. It starts one instance of `civicdata-<stage>-gather`, the same as the schedule does. The Cloudflare dashboard (Workers & Pages, Workflows) starts one too. To gather again although the date has not moved, delete the `series/v2/World Bank` row of `series_version` first.
