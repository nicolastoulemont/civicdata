# Stored series

World Bank charts read from our own copy of the World Development Indicators instead of asking the World Bank for each chart. A Workflow, `GatherWorkflow` (`packages/server/src/Gather.ts`), fills each stage's copy every day at 05:00 UTC. Deploys start no run: a new stage, such as a pull request's preview, stores nothing until its first 05:00 or a run started by hand (below), and its charts ask the World Bank until then. Eurostat and OECD charts still ask their source; they will move to the same store.

## What a run does

1. It asks the World Bank when the World Development Indicators last changed (`/v2/sources/2`). When that date equals the one the last complete run recorded, the run stops there: one request, no writes.
2. Otherwise it takes the World Bank indicators of the published catalog, 50 a step in code order, and downloads each one's bulk file (`/v2/en/indicator/<indicator>?downloadformat=csv`), two at a time, through `Pace`. The file is a ZIP of about 50 KB whose CSV holds every economy and year since 1960, and the World Bank serves it in about a tenth of a second. The API's own query for every country and year answers about 3 MB and, for an indicator nobody asked for lately, takes from seconds to several minutes: in the first preview run 8% of those queries timed out. The CSV holds the same values as the API. The run keeps the 217 economies the app charts, so the World Bank's regions and income groups never reach the store; no chart showed them before either.
3. It offers each answer to the store (below), then records the date once every indicator is stored, unchanged or held back. If an indicator failed, the date stays unrecorded and the run fails, so the next run asks for every indicator again; the ones that did not change write nothing.

A step saves the last indicator it gathered and its counts. A run that stops part way resumes after the last step that completed. A run that finds no World Bank entries in the catalog fails its first step and retries for about half an hour, in case a catalog build is still publishing them.

## The store

Each indicator is one JSON object in the stage's `Series` R2 bucket, at `series/v1/world-bank/<indicator>`: its name and definition, the dataset to credit, the release date it came from, when it was fetched, and every observation, sorted by country and year. Eurostat and OECD series will live at `series/v1/<source>/<indicator>/<dimension values>`. A change to what an object holds bumps `v1`, so no reader decodes an object of another format; a reader that meets one anyway treats the series as not stored.

The bucket is separate from `Cache`: the cache holds answers that can expire and are refetched, while a stored series stays until the World Bank publishes a change, and the bucket's own size and write counts are the store's.

Each object carries the SHA-256 of its values, name, definition and dataset in its metadata, leaving out when it was fetched and the release date. Before storing an answer the run compares hashes, so an unchanged series costs one `head` request and no write, and keeps its original retrieval time.

## Holding back a candidate

When the hashes differ, the run reads the stored series and compares:

- An empty answer, or one that lacks a country-year the stored series has, is held back. The stored series keeps serving, and the run records the candidate in D1's `series_held`: the series key, `Empty` or `Lost`, the lost country-years as JSON, the release and the retrieval time.
- Otherwise the answer replaces the stored series. Sources revise values, sometimes by a lot, and nobody reviews each release; added countries or years are welcome.

A held-back series' row goes once a later answer replaces the stored series or matches it again. The World Bank answering that it no longer knows an indicator counts as an empty answer.

D1's `series_version` holds the release each scope was last gathered from in full: `World Bank` for now, one row per Eurostat dataset later.

## Reading

`WorldBank.stored` answers a chart from the stored series, filtered to its countries and years: the explorer, `show_chart`, `find_years`, share cards and an indicator's description all go through it. The chart cites the stored series' retrieval time and links the World Bank request for its own countries and years, which returns the same values. An indicator with no stored series, or a bucket that fails, falls back to the live query and its one-day cache.

## Start a run by hand

Run the `Gather series` GitHub workflow with the stage, `prod` or `pr-<number>`, from the Actions tab or with `gh workflow run gather.yml -f stage=pr-123`. It starts one instance of `civicdata-<stage>-gather`, the same as the schedule does. The Cloudflare dashboard (Workers & Pages, Workflows) starts one too. To gather again although the date has not moved, delete the `World Bank` row of `series_version` first.
