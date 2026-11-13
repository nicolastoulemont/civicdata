# Paper store

Research papers live in a store of their own: a D1 database bound as `PAPERS_DB` and an R2 bucket bound as `PAPERS`. The database holds each paper's bibliography, its copies, the versions extracted from them, their page-bound passages and their annotations. The bucket holds each version's PDF and extracted text. The catalog database holds no paper table: passage search would otherwise queue behind catalog searches, since D1 runs one query at a time per database.

`packages/server/src/research/store.ts` defines the tables, and every writer and reader imports it. `packages/server/src/research/Papers.ts` is the reader.

## Who writes

Requests only read the store. Two writers fill it, and only they create its tables (`tables` in `store.ts`):

- the publication command, run from a machine, which publishes the locally gathered corpus and withdraws copies;
- the annotation Workflow, which writes annotations and points versions at them.

A reader never creates, alters or drops a table, for the reason `packages/server/src/built.ts` gives: a preview may read production's store.

## Bindings and stages

`packages/infra/alchemy.run.ts` declares the database as `PapersDatabase` and the bucket as `Papers`, since an Alchemy id names one resource of any type, and puts both in the same split as the catalog: production and a stage deployed by hand own theirs, and a `pr-<n>` preview without the `own-catalog` label, or `alchemy dev` without `OWN_CATALOG=true`, binds production's through `Resource.ref` ([deploys](deploys.md#what-a-preview-shares-with-production)). A destroy of such a stage never reaches production's papers. With the label, a preview gets an empty database and bucket of its own, which stay empty until someone publishes to that stage.

A production destroy keeps the papers database, because annotations cost model calls to redo. Every other stage's destroy deletes its database and empties and deletes its bucket.

## Tables

| Table        | One row per                                                                     |
| ------------ | ------------------------------------------------------------------------------- |
| `paper`      | paper: OpenAlex id, study, OpenAlex record, metadata reason, active version     |
| `copy`       | exact copy of a paper: its location, licence evidence, admission and withdrawal |
| `version`    | extraction of an admitted copy's PDF: hashes, pages and active annotation       |
| `passage`    | page-bound passage of a version, for search                                     |
| `annotation` | annotation of one text, under its annotation key                                |

A paper's id is its seed's id. A fetched copy's id is the hash of its location, source version and PDF SHA-256 (`scripts/papers/pdf.ts`), so a different file at the same URL is a different copy. A copy never fetched, such as one whose licence was not admitted, hashes its paper, location and source version: two records of one work list the same locations, and each keeps its own row. A version's PDF and text sit at `objectsOf(version)` in the bucket. Its `text` column is the SHA-256 of the text object's bytes: a JSON array of the version's passages in page order.

The annotation key is the SHA-256 of the text's hash, the extraction version, the model and the rubric (`annotationKey`). Copy identity stays out of the key, so copies with the same text share one annotation, and each copy keeps its own URL, licence and version for citations.

## Rules the tables enforce

D1 enforces foreign keys, and the store's rules are foreign keys and checks, so a writer cannot break them:

- A reader reaches text only through `paper.active`, a version of one of the paper's own copies. A writer sets it last: after the version row, its passages and its objects are in place. Until then a new paper reads as missing, and a publication that fails before that step leaves the previous active version in place.
- Only an admitted copy has versions. A version references its copy together with an admission that can only be `Admitted`, so a restricted, retracted, unidentified or withdrawn copy has none, and a copy cannot lose its admission while it has one.
- A version points to an annotation only if that annotation is of its text and extraction.
- A paper with a metadata-only reason has no active version.

Withdrawing a copy for rights or a retraction therefore runs in this order: clear `paper.active` if it points to one of the copy's versions, delete the copy's objects and versions (their passages go with them), then set the copy's admission to `Withdrawn` with its reason. An annotation stays, since another copy with the same text may point to it.

## Publication

`pnpm --filter @repo/server run papers:publish` copies a gathered corpus directory into one stage's store. `--corpus` names the directory, `.papers/corpus-v4` by default. The command runs on a machine, never in the Worker, and calls no model: it needs no `OPENAI_API_KEY`, and annotations come from the corpus.

It reaches the store through Cloudflare's API, like `packages/server/scripts/d1.ts`, with four variables the person running it supplies:

- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, a token with D1 and R2 write access;
- `PAPERS_D1_ID`, the id of the stage's `PapersDatabase`;
- `PAPERS_R2_BUCKET`, the name of the stage's `Papers` bucket.

A publication writes to the stage those two name, and to no other. A `pr-<n>` preview without the `own-catalog` label, and `alchemy dev` without `OWN_CATALOG=true`, read production's store, so they show what production holds. To try a corpus on a preview, label its pull request `own-catalog` and name the preview's own database and bucket. Publish to production only with the owner's approval.

For each record of the corpus, in the writer order above:

1. A `paper` row with the bibliography, and the metadata reason when the record has no text.
2. A `Restricted` copy, with no evidence, for each copy the gather tried and excluded. A failed attempt gets no row: it decided nothing, and the next gather retries it.
3. For a record with text, its `Admitted` copy with the licence evidence, and a version under the extraction `unpdf-2.1.0/300-words` (`extraction` in `scripts/papers/pdf.ts`).
4. The record's saved annotation, when one still fits the record (`fits` in `scripts/papers/retrieval.ts`), stored under `annotationKey` and made the version's active annotation. When the corpus has none for a version, an annotation the Workflow wrote stays.
5. The version's passages and its PDF and text objects. The command uploads each object and reads it back, and sets `paper.active`, last, only when R2 holds bytes with the expected SHA-256.

Before writing, a run reads the store's paper, copy and version rows once and compares them with the rows it would write. A paper whose rows match gets no write. Publishing an unchanged corpus therefore writes nothing, and a run after a failure writes only the papers that failed or changed. One paper's failure never stops another's. The report counts the papers per outcome and lists each written or failed one, never a passage, and the command exits 1 when a paper failed.

A paper fails, and keeps whatever the store held, when:

- its record does not decode, its file name or copy id does not match, or its PDF is missing or has another hash;
- an upload fails, or R2 holds other bytes after it;
- the corpus lists as metadata-only a paper whose text the store serves: withdraw its copy first, with the reason;
- the store holds one of its copies for another paper, or holds other text under the same version: change `extraction` whenever the parser or the passage cut changes.

Publication never admits a withdrawn copy's text again. A new copy of the paper, with another PDF, is a different copy and publishes as usual. When a paper's active version moves to a new copy, the old copy and its version stay, inactive.

## Withdrawal

`pnpm --filter @repo/server run papers:publish --withdraw <copy> --reason Rights` (or `Retraction`) removes one copy's text, with the same variables. The copy's id is `content.id` in its record and `copy.id` in the reader's `Text` answer. The command runs the order the rules above give: it clears `paper.active` if it points to one of the copy's versions, deletes the versions' objects, deletes the versions (their passages and annotation pointers go with them), and sets the copy to `Withdrawn` with its reason. The annotation row stays for any other copy with the same text. From then on the reader answers `Withdrawn` with that reason until another copy of the paper becomes active.

Withdrawing a copy that is already withdrawn with the same reason writes nothing. A copy that was never admitted has no text to withdraw, and the command refuses it.

## Local reproduction

The corpus archive is kept outside Git and published nowhere; the owner supplies it by hand. To rebuild the corpus directory from it, check it against the committed SHA-256 and extract it into an empty directory, as the [expanded corpus runbook](research/papers/expanded/README.md#build-search-and-replay) shows, then pass that directory to `--corpus`.

`packages/server/scripts/papers/publish.test.ts` runs publication, a no-op rerun, a partial failure, withdrawal and annotation import against SQLite behind D1's HTTP API and an in-memory R2, and reads each paper back through `Papers.read`. It needs neither Cloudflare nor the archive: `pnpm --filter @repo/server test`.

## Reading

`Papers.read(paper)` answers one of:

- `Text`: the bibliography, the copy, the version, its passages from the text object, and the version's active annotation or none.
- `Metadata`: the bibliography and why the paper has no text.
- `Withdrawn`: the bibliography and why its copy was withdrawn, so an old citation card can say why its quote is gone.

It fails with `PaperMissing` for an unknown paper or one whose publication has not finished, `PaperCorrupt` when the text object is missing, has another hash or does not decode, and `PapersUnavailable` when D1 or R2 fails, a table is missing, or the Worker binds no store.

## Search

`Discovery.search(query)` in `packages/server/src/research/Discovery.ts` finds papers by the words of their titles and of their active version's passages, with BM25 over the `search` table in `PAPERS_DB`. It is discovery, not evidence: a match says the words are on the page, never that the paper supports a claim. Causal scope, passage quality and sentence support still gate what an answer may cite.

`search` is an FTS5 table that `tables` creates with the other tables, with one row per paper (its title) and one per passage (its text). Triggers on `paper` and `passage` keep it in step: a writer fills it by writing those rows, and a version's deletion removes its passages' rows. A store written before the index existed gets its rows the first time a writer runs `tables`. A writer must not use `INSERT OR REPLACE` on `passage`: SQLite runs no delete trigger for a replaced row. The store holds no abstract, so search reads titles and passages only.

A query becomes an FTS5 expression of quoted words joined by `OR`, matched against titles and passage text only, so its text never reaches FTS5 as syntax. Common English words are dropped. A query with no word left fails with `QueryInvalid` `Empty`; one over 1,000 characters or 16 words fails with `QueryInvalid` `Long`. The index uses the porter tokenizer, so "retirement" matches "retire".

Ranking:

- bm25 weighs a word in a title ten times one in a passage.
- The search reads the index's 100 best rows of published papers: a title of a paper with text or a metadata reason, or a passage of a paper's active version. The index leads the join; `version` and `paper` are read by primary key.
- A passage that reads as a reference list (dense author initials, years before titles, volumes, page ranges, DOIs) is dropped, so a paper is not found for the titles it cites. On the 502 labelled passages of `corpus.json` the check flags 34 of the 42 reference passages and 6 of the 460 others, mostly tables and title pages.
- Rows group by paper. A paper scores its title's bm25 plus that of its best three passages, and search returns the best ten papers.

Each `Match` is one of:

- `Text`: the bibliography, the copy, the active version (its `id` is the version a demand records), whether that version has an annotation, and up to three passages the words found, best first, each with its physical page and part.
- `Metadata`: the bibliography and why the paper has no text. It never carries a passage.

A match carries no citation and does not decode as the domain's `Paper`. Search never reads an annotation's scope: an unannotated paper is found like an annotated one, and no publication year, affiliation or keyword stands in for a study's period or population. A withdrawn paper or one whose publication has not finished is not found. Search only reads `PAPERS_DB`: it never touches `CATALOG_DB` or the bucket, records no demand and schedules nothing. It fails with `PapersUnavailable` when D1 fails, the tables are missing, or the Worker binds no store.

`packages/server/test/Discovery.test.ts` runs search inside workerd against D1, and against a sample: the eight papers of `corpus.json`, unannotated, and the metadata of the 93 other records the corpus run found (`docs/research/papers/corpus-run.json`). Each of its 12 queries ranks its wanted papers in the first two results.

## Demand

A question never starts paid work. It records which unannotated paper versions it matched, and the daily annotation run annotates the ones asked for most. `Demand` in `packages/server/src/research/Demand.ts` keeps that record in the `demand` table of the stage's own `DB`, where requests already write, not in `PAPERS_DB`, which requests only read. A preview's `DB` is always its own, so its demand never reaches production's. In production `DB` is also the catalog database.

| Column    | Holds                                                        |
| --------- | ------------------------------------------------------------ |
| `version` | the version's id, `Version.fields.id` in `store.ts`          |
| `count`   | how many calls asked for it; a call counts each version once |
| `last`    | when a call last asked for it, as ISO 8601 UTC               |

`record(versions)` runs one `INSERT ... ON CONFLICT DO UPDATE` over all the versions, so concurrent calls add up and nothing reads the table first. The first call in a Worker also creates the table if it is missing, as the answer log does ([answers](answers.md)). `since(time)` returns the versions asked for at or after `time`, most asked first, with their counts in all; it is for the daily run, never a request. Both fail with `DemandUnavailable` when D1 fails or the Worker binds no `DB`.

Demand is advisory: nothing depends on it being exact, so it shares no transaction with `PAPERS_DB`. To read it by hand, run SQL against the stage's database in the Cloudflare dashboard (Storage and databases, then D1, then the stage's database, then Console):

```sql
SELECT version, count, last
FROM demand
WHERE last >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
ORDER BY count DESC
```

## Tests

`packages/server/test/papers.ts` fills a test store the way the writers must: `publish` for a paper with text, `list` for a metadata-only paper, `withdraw` for a withdrawn one. Each is valid by default and takes only what a test changes. `packages/server/test/Papers.test.ts` runs the reader against D1 and R2 inside workerd.
