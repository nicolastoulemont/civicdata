# Indicator catalog and political records

One Workflow, `CatalogWorkflow`, builds the indicator catalog and stores the political records. Searches and charts only read what it stored.

## Indicator catalog

Indicator search reads a catalog of World Bank indicators, Eurostat datasets and OECD dataflows, kept in D1 for search by words and in Vectorize for search by meaning. Searches only read it. The `CatalogWorkflow` Workflow (`packages/server/src/CatalogBuild.ts`) builds it every Monday at 04:00 UTC from a native Workflow schedule, and CI starts one more build after each deploy, through the Workflows API.

The Worker reads the catalog and the political records through the `CATALOG_DB` binding. A pull request's preview binds production's database and index there and builds nothing, unless the pull request carries the `own-catalog` label ([docs/deploys.md](deploys.md#what-a-preview-shares-with-production)). Add the label to a pull request that changes a table's shape, the embedding model or the build code. Only builds create, alter or drop tables: the catalog's in `tables` and the political records' in `politicsTables`, which `CatalogBuild`, `PoliticsBuild` and `Gather` run. A reader meets a missing table only on a stage no build has written to, and answers as if nothing were published.

One build changes the catalog at a time. A build first takes a lease, a row in `catalog_lease` naming its Workflow instance, and releases it when it ends, failed or not. A build that finds the lease held sleeps 10 minutes and asks again, so the build a deploy started still runs that deploy's code after the earlier build ends. The lease expires after 12 hours, which frees it from a build that crashed without releasing it; a first build of every source makes about 110 embedding and 30 classifying steps, and a step that keeps failing gives up after about an hour. Without the lease, CI's build after a deploy could overlap the weekly one or an earlier deploy's, and the older build would remove the vectors of entries the newer one had embedded but not yet published. A build that takes the lease after a newer one published a source leaves that source alone.

A build lists each source in one request, writes its entries into a new generation, embeds its new and changed entries 100 at a time, publishes the generation, which drops the source's older ones, then removes the vectors of the entries it dropped. Each of those is a Workflow step: a failed step retries alone, for about half an hour, and a resumed build skips the steps that completed. Sources build side by side, so one that stays down keeps its previous generation while the others publish. A stage answers "unavailable" to a search of every source until a build publishes one of them, and to a search of one source until a build publishes that source, so a source that has never built does not answer that it lists no such indicator. Eurostat's list carries names only: its full list with descriptions is 20 MB. The World Bank's list is the World Development Indicators, which republish the estimate and 0 to 100 score of the six Worldwide Governance Indicators (`GOV_WGI_*`) and leave out their standard errors and confidence bounds; their charts credit the Worldwide Governance Indicators.

The write step leaves out the Eurostat datasets and OECD dataflows that no chart can show ([Dataset outlines](#dataset-outlines)), then compares a fingerprint of the listing with the one stored beside the source's published generation (`catalog_fingerprint`). The fingerprint is a SHA-256 of the sorted entries, the labels each embeds and the embedding model, so a deploy that changes any of them rebuilds the source. When they match, the step writes nothing and the source stops there, keeping its published generation. The step saves that decision, so a resumed build makes the same one. A build where no source changed makes one listing request per source and three outline requests, fourteen steps (a write and a classify per source, an outline, a label and a describe step for Eurostat and the OECD, and taking and releasing the lease), and no Workers AI or OpenAI calls. A new stage, or one whose generations predate fingerprints, builds everything once.

When a source did change, `catalog_vector` decides what to embed. It records, for each vector in Vectorize, the entry's name, definition and labels and the model that embedded it, written after each upsert. An embed step takes the generation's next 100 entries that differ from that record, embeds them in one Workers AI call and one Vectorize upsert, and saves the last row it embedded as its cursor. Entries whose name, definition and labels did not change keep their vectors, and a change of embedding model differs from every record, so it embeds everything again. After publishing, a remove step deletes the vectors of up to 100 recorded entries that neither the published generation nor a newer one lists, and saves how many it deleted. A build where one World Bank entry was renamed makes one Workers AI call for 1 entry and one Vectorize upsert, where it used to embed every World Bank entry; a dropped entry adds one Vectorize delete.

Each step reads its decision from D1 and saves only a cursor or a count, so a resumed build embeds and removes the same entries as one that did not stop, even when the Worker stopped after a step ran but before Workflows saved it. Vectors change before the generation that needs them is published, as before; until a removal runs, search by meaning drops neighbors the published generation does not list. A stage whose tables predate `catalog_vector` gets the table on its next build and embeds each changed source in full once. A stage whose `catalog_vector` predates labels gets them empty, so its next build embeds again each Eurostat and OECD entry whose outline has labels.

Every build then classifies which way each entry's values are better: Higher, Lower or Neutral, which colours maps and change charts green to red (`packages/server/src/ModelClassifier.ts`). Only production classifies: `packages/infra/alchemy.run.ts` sets `CLASSIFY_DIRECTIONS=on` for the `prod` stage alone, and the Workflow classifies when that setting and an OpenAI key are both there. A preview without the `own-catalog` label reads production's directions. A preview with it, local dev and the eval classify nothing, so their maps colour only the hand-checked indicators; the agent in a preview keeps its key. Each such preview has its own catalog, so each would pay a full pass on its first build.

Classifying runs for every source that listed, changed or not, over the published generation. `catalog_direction` records, for each indicator, the direction, the name and definition the model read, and the model that answered; it is kept across generations. A classify step takes the next 400 entries whose name, definition or model differ from that record, asks OpenAI's Decisions API (`POST /v1/decisions`, `gpt-6-luna`) about them in one request, stores the answers and saves the last row it asked about as its cursor. 400 is the most questions the API takes in one request. The request holds the rules in a developer message and one choice question per entry, named by its code, with the values Higher, Lower and Neutral. The question holds the entry's code, name and definition cut to 400 characters; the catalog stores no unit apart from what the name says. The API answers each question with a choice and a confidence. A choice below 0.8 confidence is stored as Neutral, and so is a refusal, a choice outside the three or a question the API leaves out. A request that fails stores nothing and ends the source's classification for that build, which still succeeds; the next build asks again. A build where nothing changed makes no request. A change of model differs from every record, so it asks about everything once more; directions stored before the record held a model have an empty one, and charts keep reading them until the next build replaces them.

A chart reads its indicator's direction from the hand-checked list in `packages/server/src/Directions.ts` first, then from `catalog_direction`, else Neutral. A full pass over the catalog's 10,658 entries is 28 requests. Decisions input costs $0.10 per million tokens and output is not charged; the rules are under the 1,024 tokens prompt caching needs, so nothing is cached.

## Dataset outlines

A Eurostat dataset or an OECD dataflow holds many series, by sex, age, unit and so on. The catalog stores each one's outline (`packages/server/src/Outlines.ts`): its dimensions with the codes in use and the label of each code, whether it has annual values, which of our countries it covers, and its first and last year. World Bank indicators have none: each is one series. The years and countries bound the whole dataset, not each series; `find_years` gives a series' own.

`catalog_outline` holds one row per dataset, with each dimension's codes and codelist as JSON and a fingerprint of what it holds. `catalog_label` holds the label of each code, by source and codelist ("ESTAT:SEX", "OECD:CL_AGE", without the codelist's version), empty until a build or the first fill reads it. The codes in use are those with data: Eurostat's metabase lists only those, and so does the OECD's "Actual" content constraint. `Sdmx` likewise offers only the codes that have a series.

Both sources publish all of it in bulk. Measured on 2026-11-11:

| File                                                              | Size                   | Holds                                                                           |
| ----------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| Eurostat `catalogue/metabase.txt.gz`                              | 4.1 MB, 34 MB unzipped | each dataset's dimensions and codes in use, countries and periods, one per line |
| Eurostat `sdmx/2.1/codelist/ESTAT/all/latest?format=JSON&lang=en` | 58 MB                  | the label of every code                                                         |
| OECD `contentconstraint/all/all/latest`                           | 6.6 MB                 | codes in use per dimension, with frequency, countries and time range            |
| OECD `codelist/all/all/latest`                                    | 33 MB                  | 848 codelists, 133,920 labels                                                   |
| OECD `datastructure/all/all/latest?detail=full&references=none`   | 2 MB                   | each structure's dimensions and the codelist of each                            |

The metabase names no frequency: a period of four digits is a year. A dataset has annual values when one of its periods is a year, and its years are those periods. An OECD dataflow has annual values when its frequency dimension lists `A`, or when it has no frequency dimension, as the data requests in `Sdmx` read it; its years are its constraint's time range. The baseline listing had 32 OECD dataflows with no constraint; empty constraints also yield no outline, and 50 dataflows name a structure the file lacks. Several Actual constraints can name the same dataflow: their regions are combined before fingerprinting, so a weekly refresh writes one stable outline per dataflow. The first have no outline and the second no labels; both keep learning their dimensions from `find_years`' rejection.

### What a Worker can read

Decoded, the two codelist files outgrow a Worker's 128 MB: in separate Node processes, JSON parsing, Schema decoding and building the label maps grew the heap by 295 MB for Eurostat and 150 MB for the OECD. Decoding the constraints took 31 MB and the structures 8 MB, and the metabase is unzipped and read a line at a time as it streams. The OECD structures file is also needed to map dimensions to codelists; constraints alone do not give that mapping. So the catalog Workflow reads only those three, and asks for a single codelist when it meets codes without labels. A local script reads all five, once per stage.

### The first fill

`packages/server/scripts/outlines.ts` fills a stage's outlines and labels from the five files, writing through Cloudflare's D1 HTTP API as Alchemy's default login:

```sh
STAGE=prod pnpm --filter @openfacts/server run outlines
```

It writes to the database named `civicdata-Database-<STAGE>-*`, creates the catalog's tables if no build has, and logs what it wrote, the rows D1 counted, how long it took and the database's size before and after, from statement metadata rather than the database listing's stale size. It writes only what changed, so running it again is safe. Run the fill while no catalog build is active: the script does not take the Workflow lease. Then start a catalog build ([Rebuild by hand](#rebuild-by-hand)): it leaves the datasets no chart can show out of search and embeds the labels. The script and the Workflow share the parsing and writing code in `Outlines.ts` and `Structures.ts`; only where the labels come from differs.

### The weekly refresh

Each build runs three kinds of step for Eurostat and the OECD before their write step:

1. An outline step reads the metabase, or the constraints and the structures, and writes only the outlines whose fingerprint changed. It gives a `catalog_label` row to each code of an outline that search shows, and deletes the outlines of datasets the file no longer lists. A file the source fails to give leaves the stored outlines in place.
2. Label steps ask for each codelist whose codes lack labels, one request each: up to 25 per step for Eurostat, and 10 per build for the OECD, whose 50 requests an hour charts share. A code its codelist lacks is labelled with itself, so no build asks for it again. A codelist that fails to arrive waits for the next build.
3. A describe step writes, for each outline whose labels changed, the text search embeds with the dataset's name: its codes' labels, dimensions with fewer codes first, up to 20 per dimension and 1,500 characters in all. A search by meaning then finds a dataset by a label: "women" finds unemployment by sex, whose sex dimension has "Females". Word search reads names and definitions only.

After the first fill, a build where nothing changed writes nothing to either table and asks for no codelist. Without the fill, a new stage labels Eurostat over its first build, about 600 requests, and the OECD 10 codelists a week.

### What search and the agent read

Search leaves out datasets with no annual values or none of our countries: no chart can show them. On 2026-11-11 that was 1,282 of Eurostat's 7,610 datasets and 244 of the OECD's 1,507 distinct dataflows with a usable constraint. `search_indicators` returns each match's dimensions that take more than one code, with up to 8 codes and their labels, a total first, and how many more there are. It returns `null` for a dataset without an outline, and no dimensions for a World Bank indicator. The catalog stores every code; only the tool cuts the list.

### Preview measurement, 2026-11-11

The first fill wrote to `pr-154` through D1's HTTP API, replaying the five complete files downloaded that day. No measurement wrote to production. The preview holds 7,610 Eurostat outlines, 1,507 distinct OECD outlines and 81,077 labels (39,410 Eurostat, 41,667 OECD). Its D1 size after filling was 33,415,168 bytes, from statement metadata.

A transient HTTP 500 interrupted the first pass. The successful resumed pass took 3m 24.465s and D1 counted 167,772 writes; this excludes the failed pass's partial writes. Combining duplicate OECD constraints then changed six outlines and one embedded text in 28.643s. A subsequent full repeat took 31.069s, read 236,600 rows and wrote zero rows, with no change in size. Repeating the script after a failed pass resumes from the stored fingerprints.

Labels are allocated to the codes used by searchable datasets; excluded outlines still keep all their dimension codes. A missing codelist or a code with no source label remains readable as its code. The bulk constraints describe dataset-wide coverage, not which country has which years for a chosen series.

## Political records

Trend charts can mark each country's national elections and shade who governed it, for the EU and OECD members. The same `CatalogWorkflow` run stores elections and governments in D1 (`packages/server/src/PoliticsBuild.ts`), one generation per publisher and kind like the catalog, and `GET /api/politics?countries=ESP,PRT&from=2000&to=2020` reads them (`packages/server/src/Politics.ts`). The publishers, what each records and their licences are in the README's [sources table](../README.md#sources-and-licences).

PPEG counts within its coverage, ParlGov fills the years before it, and records checked by hand follow both. PPEG and ParlGov can date the same election differently (France's first or second round), so they are never added together. The sources record when a government starts, never when it ends: it ends when the next starts. No winner or coalition is inferred from an election. European Parliament elections are left out. The chart credits PPEG and ParlGov with the citations they ask for.

The same route answers major events and pension reforms from a snapshot checked in beside the official pages (`events.json`, `reforms.json`, ported from countries-comparison; see `packages/server/src/official/README.md`). Every record cites at least one https page, which the card's source line links. An event shows on a country's chart only if it concerns that country, and a reform only on a chart of its policy area: `areas` in `packages/domain/src/Politics.ts` lists the Eurostat and OECD indicators of each. No build stores them, but the route still answers "unavailable" until builds have published the elections and the governments of every publisher. Every answer reads all six, so one missing would show a country as having no government records when they are only not stored yet.

Like the catalog's, the write step skips a publisher's records of one kind when their fingerprint matches the published generation's (`politics_fingerprint`). The fingerprint leaves out when the build fetched them, which changes every build, so skipped records keep the retrieval time of the build that stored them. A build where nothing changed makes six steps.

## Rebuild by hand

To rebuild a deployed stage, start an instance from the Cloudflare dashboard (Workers & Pages, Workflows, `civicdata-<stage>-catalog`) or with `POST /accounts/<account>/workflows/civicdata-<stage>-catalog/instances`. A preview without the `own-catalog` label has no catalog Workflow to start.

## Indicator identity and new publishers

`Source` decodes a publisher's name, used as its adapter registry key, search filter and chart credit. Names contain ASCII letters and numbers separated by spaces or hyphens. `NativeId` decodes its own code (ASCII letters, numbers, dots, underscores, hyphens, commas and `@`). Neither admits a colon or a path separator. `identify(source, native)` constructs an `IndicatorId`; `sourceOf` and `nativeId` recover its publisher and code. New publishers always use `Publisher:native-code`, including bare file column names and other SDMX agencies. Register the adapter in `Sources.layer`; catalog builds and gather enumerate that registry. No production publisher or data is added by the identity change.

The three deployed forms remain canonical: bare World Bank codes, `ESTAT,flow,version` and `OECD[.directorate],flow,version`. Their share parameters, saved conversation charts, findings, direction overrides, counterparts, titles, catalog rows, vector ids and cache keys keep their bytes. There is no rewrite or backfill, and unchanged catalog fingerprints remain unchanged. New namespaced ids longer than Vectorize's 64-byte limit use word search only, like existing long OECD ids; admitted ids are ASCII, so character and byte lengths agree.

Search tools return the catalog's dataset-wide country and year bounds when an outline exists, or null when unknown. The agent searches the catalog instead of choosing a publisher from EU or OECD membership. It filters by a requested publisher and checks the selected series with `find_years`; dataset bounds do not promise that every series covers every country and year.

This changes how the catalog build enumerates adapters, so the PR needs `own-catalog`. Its preview builds its own catalog and starts with an empty series bucket, per the normal preview contract. Production needs no manual operation. Later adapters must publish ids through `identify`, implement `Adapter`, preserve source attribution and terms, and register HTTP hosts and reviewed pacing budgets for API reads. Publishers without a budget get one request per minute and a one-minute cooldown. File metadata uses the discovery capability below. Store-only/selective policies and asset progress are described in series.md; coherent release publication is an optional ingestion capability. Observation quality remains a separate slice.

## Publisher discovery

An adapter's optional `discovery` capability supplies a stream of `Outline` values. The catalog runs that capability for every registered adapter before listing it; orchestration has no publisher checks. No capability means metadata is unavailable. An outline uses `annual: null`, `countries: null` and `years: null` for unknown facts. `annual: false` or `countries: []` confirms a dataset cannot be charted and excludes it from search. Bounds cover the dataset, never each selected series. A source adapter decodes its wire or file input before constructing outlines.

A future INSEE adapter can stream its national annual dataset metadata with its real SDMX codelists where present. A file adapter instead sets each dimension's `codelist` to null and supplies `labels`, a record keyed by its codes, alongside the codes in source order. It invents no agency or version. Both paths feed the same search dimensions and label-sensitive embedding text. Single-code dimensions need no model choice; search lists dimensions with several codes. Missing labels fall back to codes. `search_indicators` explicitly includes nullable dataset coverage in its result schema.

Only adapters with API codelists supply `discovery.codelists`: a label reader plus `perStep` and `steps`. Eurostat retains 25 codelists per step with no step cap; OECD retains 10 in one step per build. Their streaming metabase, constraints/structures parsers and bulk first-fill script are unchanged. Catalog HTTP reads, including discovery, use the gathering pacing layer.

Changed outline chunks now go to `catalog_outline_stage` before publication. A failed stream changes no published outline or labels, even after it staged a chunk. A successful stream applies the changed rows and removes outlines it no longer lists; an empty stream preserves everything. The next attempt clears any abandoned staged chunks for its source. A discovery failure fails that source's build and keeps its published catalog generation; other sources still advance. Missing individual API codelists remain best effort, retried on a later build. This staging protects a failed download; it does not activate metadata, vectors and observations as one coherent release.

### Compatibility and rebuild impact

Builds add the staging table with `CREATE TABLE IF NOT EXISTS`. No existing table is rebuilt. Existing SDMX outline JSON and fingerprints remain byte-for-byte equivalent when metadata is unchanged: inline labels are optional and absent there. Existing annual integers 0/1 and country arrays stay unchanged. Unknown annual eligibility uses -1 in storage; unknown countries use JSON `null` in the existing text column. The new reader accepts both the old and extended forms. Old readers continue reading the deployed publishers' unchanged rows; an adapter emitting nullable coverage must ship after this reader, since old codecs cannot decode JSON null countries. This infrastructure PR registers no such publisher. Its isolated `own-catalog` preview uses the new reader and writer together.

No ids, vector ids, store paths, ledger scopes or World Bank fingerprints change. No full World Bank gather or embedding rebuild is required, and no manual production fill is needed. Normal builds create the table and reuse unchanged fingerprints. Later source PRs must preserve each publisher's terms and attribution. Read policies and asset progress are independent of catalog discovery; see [series.md](series.md#sources). A selected mirror leaves the rest of the catalog searchable. Coherent observation publication is a source opt-in described in [series.md](series.md#coherent-releases); it does not atomically publish catalog metadata and observations together. Forecast/uncertainty/quality and source methodological notes remain separate work.

## INSEE discovery

`Insee` registers `INSEE:DD_CNA_AGREGATS`, Melodi's GDP and main economic
aggregates dataset. This first integration intentionally does not list the
other 162 records observed in `/catalog/all` on 11 November 2026: their measures
and dimension contracts have not been checked. It uses `/catalog/DD_CNA_AGREGATS`
for the publisher's name, definition and `modified` timestamp, and
`/range/DD_CNA_AGREGATS` for the actual codes and labels. The existing catalog
Workflow publishes the entry and its outline; searches read this local catalog.
No chart request rebuilds it.

Discovery requires annual frequency and exposes only exact `YYYY-FRANCE-F`
geographies as `GEO` choices, labelled with their full source id. It never maps
regional codes to France or merges geography vintages. Coverage is France alone;
the agent permits only a trend for FRA, rejecting rankings, maps and comparisons.
Every dimension must be chosen, even a singleton. `REF_YEAR_PRICE` is an attribute
that distinguishes price bases: its sourced years are offered separately from
`_Z`, our explicit representation of null (no reference year). This sentinel is
never sent as an INSEE code. Invalid combinations return no observations; the
adapter never substitutes a different price basis, sector, unit or counterpart.
The catalog names no Eurostat counterpart. The app's existing 1960 lower year
bound still applies, though the publisher's dataset starts in 1949.

Official references: [API catalogue](https://www.insee.fr/fr/information/8184146),
[anonymous access and 30 requests/minute](https://www.insee.fr/fr/information/1302169?question=comment-utiliser-l-api-melodi),
[Melodi OpenAPI and endpoint licence](https://api-apimanager.insee.fr/portal/environments/DEFAULT/apis/a890b735-159c-4c91-90b7-35159c7c9126/pages/ee625968-272a-4637-a259-68272aa63766/content),
and [user guide](https://api-apimanager.insee.fr/portal/environments/DEFAULT/apis/a890b735-159c-4c91-90b7-35159c7c9126/pages/712a242a-9d5c-4675-aa24-2a9d5c4675c4/content).
The separate BDM service supports SDMX 2.1; this adapter reads Melodi JSON, not BDM.
