# Stored series

World Bank and Eurostat charts read from our own copy of their data instead of asking the source for each chart. A Workflow, `GatherWorkflow` (`packages/server/src/Gather.ts`), fills each stage's copy every day at 05:00 UTC: the World Bank first, then Eurostat. Deploys start no run: a new stage, such as a pull request's preview, stores nothing until its first 05:00 or a run started by hand (below), and its charts ask the sources until then. OECD charts still ask the OECD; they will move to the same store.

## What a run does for the World Bank

1. It asks the World Bank when the World Development Indicators last changed (`/v2/sources/2`). When that date equals the one the last complete run recorded, the run stops there: one request, no writes.
2. Otherwise it takes the World Bank indicators of the published catalog, 50 a step in code order, and downloads each one's bulk file (`/v2/en/indicator/<indicator>?downloadformat=csv`), two at a time, through `Pace`. The file is a ZIP of about 50 KB whose CSV holds every economy and year since 1960, and the World Bank serves it in about a tenth of a second. The API's own query for every country and year answers about 3 MB and, for an indicator nobody asked for lately, takes from seconds to several minutes: in the first preview run 8% of those queries timed out. The CSV holds the same values as the API. The run keeps the 217 economies the app charts, so the World Bank's regions and income groups never reach the store; no chart showed them before either.
3. It offers each answer to the store (below), then records the date once every indicator is stored, unchanged or held back. If an indicator failed, the date stays unrecorded and the run fails, so the next run asks for every indicator again; the ones that did not change write nothing.

A step saves the last indicator it gathered and its counts. A run that stops part way resumes after the last step that completed. A run that finds no World Bank entries in the catalog fails its first step and retries for about half an hour, in case a catalog build is still publishing them.

## What a run does for Eurostat

Eurostat publishes about 8,000 datasets, each with dimensions (unit, sex, age, sector…), regional rows and other frequencies the app does not chart, and updates about 80 of them a day, at 11:00 and 23:00 in Luxembourg.

1. It reads Eurostat's table of contents (`/catalogue/toc/txt`): one request of about 2 MB that dates the last data update of every dataset and table, by day, and counts its values. The light dataflow list carries no dates; the full one carries the hour too but weighs 20 MB. The run records each catalog dataset's date and size in D1's `series_release`.
2. It gathers the datasets whose date differs from the one recorded in `series_version`, up to 50 a step while their values add up to five million, in code order. A dataset whose date has not moved costs no request.
3. For each one it downloads the dataset's bulk file (`/sdmx/2.1/data/<dataset>?format=TSV&compressed=true`) through `Pace`: every frequency and region, gzipped, one line per series and country. Eurostat builds it once per release and serves it at once. The data API is no use here: it answers a large query only through an asynchronous job (national accounts' 938,000 annual country values: a 20-second job, then 64 MB of CSV, where the bulk file is 3.4 MB in under a second), rejects a whole query that names a country the dataset does not cover, and ignores `updatedAfter`.
4. It reads the file as it downloads, keeping annual lines for the countries the app charts. The file is sorted by its dimensions in order, so the lines that share the dimensions before `geo` are adjacent: a block, whose series are complete once the next block starts. Most files list `geo` last, so a block is one series; in some, such as flights by partner country, dimensions follow `geo` and a block holds many. Each block's series are offered to the store (below) as soon as the block ends; the file is never held whole, and a dataset with a block of more than 200,000 values is skipped as too large.
5. It records the dataset's date once every series is offered. A dataset dated today stays unrecorded, since Eurostat may update it again at 23:00 under the same date, so the next run reads it again; its unchanged series write nothing.

A run gathers Eurostat for 20 hours at most, then stops and leaves the datasets it did not reach to the next run. A first pass stores millions of series at about 40 a second, since a Worker has at most six R2 calls in flight, so it spreads over a few daily runs instead of overlapping the next one.

A dataset is skipped, with its reason and date in D1's `series_skipped`, when its file has no annual values (`NoAnnual`), no annual values for a country we chart (`NoCountries`), more than 25 million values (`TooLarge`, about 2% of datasets, never downloaded), or Eurostat no longer publishes it (`NotFound`). Its charts ask Eurostat, as before. A dataset that fails stays unrecorded and fails the run, and the next run reads it again; the datasets that completed are not read again.

## The store

Each series is one JSON object in the stage's `Series` R2 bucket: its name and definition, the dataset to credit, the release date it came from, when it was fetched, and every observation, sorted by country and year. A World Bank indicator is one series, at `series/v1/world-bank/<indicator>`. A Eurostat dataset holds one series per combination of its dimensions' values, at `series/v1/eurostat/<dataflow>/<dimension=code,...>`, dimensions in id order, such as `series/v1/eurostat/ESTAT,UNE_RT_A,1.0/age=Y15-24,sex=F,unit=PC_ACT`; the object also records the combination. A change to what an object holds bumps `v1`, so no reader decodes an object of another format; a reader that meets one anyway treats the series as not stored.

The bucket is separate from `Cache`: the cache holds answers that can expire and are refetched, while a stored series stays until the World Bank publishes a change, and the bucket's own size and write counts are the store's.

Each object carries the SHA-256 of its values, name, definition and dataset in its metadata, leaving out when it was fetched and the release date. Before storing an answer the run compares hashes, so an unchanged series costs no write and keeps its original retrieval time, and a series with no stored hash is new and costs one write, no read. A World Bank indicator's hash costs one `head` request; a Eurostat dataset's hashes come from listing its folder, one request per thousand series.

## Holding back a candidate

When the hashes differ, the run reads the stored series and compares:

- An empty answer, or one that lacks a country-year the stored series has, is held back. The stored series keeps serving, and the run records the candidate in D1's `series_held`: the series key, `Empty` or `Lost`, the lost country-years as JSON, the release and the retrieval time.
- Otherwise the answer replaces the stored series. Sources revise values, sometimes by a lot, and nobody reviews each release; added countries or years are welcome.

A held-back series' row goes once a later answer replaces the stored series or matches it again. The World Bank answering that it no longer knows an indicator counts as an empty answer.

D1's `series_version` holds the release each scope was last gathered from in full: `World Bank` for the whole World Development Indicators, and one row per Eurostat dataset.

## Reading

`WorldBank.stored` answers a chart from the stored series, filtered to its countries and years: the explorer, `show_chart`, `find_years`, share cards and an indicator's description all go through it. The chart cites the stored series' retrieval time and links the World Bank request for its own countries and years, which returns the same values. An indicator with no stored series, or a bucket that fails, falls back to the live query and its one-day cache.

`Sdmx.stored` does the same for Eurostat. A chart still asks Eurostat, through the cache, for the dataset's dimensions and the values each takes for its countries, since bulk files hold codes, not labels; the picks and each dimension with a single value then name the stored series. A chart that leaves a dimension open fails as it does without the store. It links the Eurostat data query for its own countries, years and picks. A combination not stored, a dataset the run skipped, or a bucket that fails, falls back to the live query.

## Start a run by hand

Run the `Gather series` GitHub workflow with the stage, `prod` or `pr-<number>`, from the Actions tab or with `gh workflow run gather.yml -f stage=pr-123`. It starts one instance of `civicdata-<stage>-gather`, the same as the schedule does. The Cloudflare dashboard (Workers & Pages, Workflows) starts one too. To gather again although the date has not moved, delete the `World Bank` row of `series_version` first.
