# Indicator catalog and political records

One Workflow, `CatalogWorkflow`, builds the indicator catalog and stores the political records. Searches and charts only read what it stored.

## Indicator catalog

Indicator search reads a catalog of World Bank indicators, Eurostat datasets and OECD dataflows, kept in D1 for search by words and in Vectorize for search by meaning. Searches only read it. The `CatalogWorkflow` Workflow (`packages/server/src/CatalogBuild.ts`) builds it every Monday at 04:00 UTC from a native Workflow schedule, and CI starts one more build after each deploy, through the Workflows API.

A build lists each source in one request, writes its entries into a new generation, embeds them 100 at a time, then publishes the generation, which drops the source's older ones. Each of those is a Workflow step: a failed step retries alone, for about half an hour, and a resumed build skips the steps that completed. Sources build side by side, so one that stays down keeps its previous generation while the others publish. A stage answers "unavailable" to every search until its first build publishes a source. Eurostat's list carries names only: its full list with descriptions is 20 MB.

The write step first compares a fingerprint of the listing with the one stored beside the source's published generation (`catalog_fingerprint`). The fingerprint is a SHA-256 of the sorted entries and the embedding model, so a deploy that changes either rebuilds the source. When they match, the step writes nothing and the source stops there, keeping its published generation. The step saves that decision, so a resumed build makes the same one. A build where no source changed makes one listing request per source, three steps and no Workers AI calls. A new stage, or one whose generations predate fingerprints, builds everything once.

## Political records

Trend charts can mark each country's national elections and shade who governed it, for the EU and OECD members. The same `CatalogWorkflow` run stores elections and governments in D1 (`packages/server/src/PoliticsBuild.ts`), one generation per publisher and kind like the catalog, and `GET /api/politics?countries=ESP,PRT&from=2000&to=2020` reads them (`packages/server/src/Politics.ts`). The publishers, what each records and their licences are in the README's [sources table](../README.md#sources-and-licences).

PPEG counts within its coverage, ParlGov fills the years before it, and records checked by hand follow both. PPEG and ParlGov can date the same election differently (France's first or second round), so they are never added together. The sources record when a government starts, never when it ends: it ends when the next starts. No winner or coalition is inferred from an election. European Parliament elections are left out. The chart credits PPEG and ParlGov with the citations they ask for.

The same route answers major events and pension reforms from a snapshot checked in beside the official pages (`events.json`, `reforms.json`, ported from countries-comparison; see `packages/server/src/official/README.md`). Every record cites at least one https page, which the card's source line links. An event shows on a country's chart only if it concerns that country, and a reform only on a chart of its policy area: `areas` in `packages/domain/src/Politics.ts` lists the Eurostat and OECD indicators of each. No build stores them, but the route still answers "unavailable" until the first build stores elections and governments.

Like the catalog's, the write step skips a publisher's records of one kind when their fingerprint matches the published generation's (`politics_fingerprint`). The fingerprint leaves out when the build fetched them, which changes every build, so skipped records keep the retrieval time of the build that stored them. A build where nothing changed makes six steps.

## Rebuild by hand

To rebuild a deployed stage, start an instance from the Cloudflare dashboard (Workers & Pages, Workflows, `civicdata-<stage>-catalog`) or with `POST /accounts/<account>/workflows/civicdata-<stage>-catalog/instances`.
