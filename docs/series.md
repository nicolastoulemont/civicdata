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
| `gather`  | every series of one catalog entry, in bulk, as candidates for the store                            |
| `url`     | the API request that answers a query with the values a stored series holds, which a chart links    |

`None` means nothing is stored and every chart asks the source. The World Bank is `Full`. Eurostat and the OECD are `None`: they implement `list`, `describe` and `fetch` from their SDMX APIs (`Sdmx.ts`), and their `changed` and `gather` come when they are mirrored. The World Bank dates one release for every indicator, so its `changed` answers for all of them or none.

A series is named by its key, `SeriesKey` in `packages/domain/src/SeriesKey.ts`: an indicator and the value of each of its dimensions, none for a World Bank indicator. The store, the SDMX cache and the counterpart series that check a chart all use it.

Adding a source is one adapter and its entry in `Sources`; the type of `Sources` fails the build until every source in `Source` has one.

## What a run does

A run gathers each source whose policy is `Full`, one after the other; today that is the World Bank alone.

1. It asks the source's `changed` what to gather. The World Bank answers when the World Development Indicators last changed (`/v2/sources/2`). When that date equals the one the last complete run recorded, the run stops there: one request, no writes.
2. Otherwise it takes the source's entries in the published catalog, 50 a step in code order, and downloads each one's bulk file (`/v2/en/indicator/<indicator>?downloadformat=csv`), two at a time, through `Pace`. The file is a ZIP of about 50 KB whose CSV holds every economy and year since 1960, and the World Bank serves it in about a tenth of a second. The API's own query for every country and year answers about 3 MB and, for an indicator nobody asked for lately, takes from seconds to several minutes: in the first preview run 8% of those queries timed out. The CSV holds the same values as the API. The run keeps the 217 economies the app charts, so the World Bank's regions and income groups never reach the store; no chart showed them before either.
3. It offers each answer to the store (below), then records the date once every indicator is stored, unchanged or held back. If an indicator failed, the date stays unrecorded and the run fails, so the next run asks for every indicator again; the ones that did not change write nothing.

A step saves the last indicator it gathered and its counts. A run that stops part way resumes after the last step that completed. A run that finds no World Bank entries in the catalog fails its first step and retries for about half an hour, in case a catalog build is still publishing them.

## The store

Each series is one JSON object in the stage's `Series` R2 bucket, read and written by its key, at `series/v1/<source>/<indicator>`, then `/<dimension>=<code>,...` sorted by dimension for a series with dimensions. `<source>` is the source's name in lower case, words joined by `-`: a World Bank indicator lives at `series/v1/world-bank/<indicator>`. The object holds the indicator's name and definition, the dataset to credit, the series' dimensions, the release date it came from, when it was fetched, and every observation, sorted by country and year. An object stored before series had dimensions reads as having none. A change to what an object holds bumps `v1`, so no reader decodes an object of another format; a reader that meets one anyway treats the series as not stored.

The bucket is separate from `Cache`: the cache holds answers that can expire and are refetched, while a stored series stays until the World Bank publishes a change, and the bucket's own size and write counts are the store's.

Each object carries the SHA-256 of its values, name, definition and dataset in its metadata, leaving out when it was fetched, the release date and the key, which the object's place already names. Before storing an answer the run compares hashes, so an unchanged series costs one `head` request and no write, and keeps its original retrieval time.

## Holding back a candidate

When the hashes differ, the run reads the stored series and compares:

- An empty answer, or one that lacks a country-year the stored series has, is held back. The stored series keeps serving, and the run records the candidate in D1's `series_held`: the series key, `Empty` or `Lost`, the lost country-years as JSON, the release and the retrieval time.
- Otherwise the answer replaces the stored series. Sources revise values, sometimes by a lot, and nobody reviews each release; added countries or years are welcome.

A held-back series' row goes once a later answer replaces the stored series or matches it again. The World Bank answering that it no longer knows an indicator counts as an empty answer.

D1's `series_version` holds the release each scope was last gathered from in full: `World Bank` for now, one row per Eurostat dataset later.

## Reading

One read path serves every source, `Sources.stored`. For a source whose policy is `Full` it answers a chart from the stored series, filtered to its countries and years: the explorer, `show_chart`, `find_years`, share cards and an indicator's description all go through it. The chart cites the stored series' retrieval time and links the source's request for its own countries and years (the policy's `url`), which returns the same values. A series not stored, or a bucket that fails, falls back to the source's `fetch`, through its cache: one day for the World Bank. A description reads the series without dimensions, so a source whose series have dimensions is asked for it. A source whose policy is `None` never reads the store.

`Gather.offer` applies the hold-back rule and is the only writer to the store.

## Start a run by hand

Run the `Gather series` GitHub workflow with the stage, `prod` or `pr-<number>`, from the Actions tab or with `gh workflow run gather.yml -f stage=pr-123`. It refuses a pull request without the `own-catalog` label, whose preview reads production's store. It starts one instance of `civicdata-<stage>-gather`, the same as the schedule does. The Cloudflare dashboard (Workers & Pages, Workflows) starts one too. To gather again although the date has not moved, delete the `World Bank` row of `series_version` first.
