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

A paper's id is its seed's id. A fetched copy's id is the hash of its location, source version and PDF SHA-256 (`scripts/papers/pdf.ts`), so a different file at the same URL is a different copy. A copy never fetched, such as one whose licence was not admitted, hashes its location and source version alone. A version's PDF and text sit at `objectsOf(version)` in the bucket. Its `text` column is the SHA-256 of the text object's bytes: a JSON array of the version's passages in page order.

The annotation key is the SHA-256 of the text's hash, the extraction version, the model and the rubric (`annotationKey`). Copy identity stays out of the key, so copies with the same text share one annotation, and each copy keeps its own URL, licence and version for citations.

## Rules the tables enforce

D1 enforces foreign keys, and the store's rules are foreign keys and checks, so a writer cannot break them:

- A reader reaches text only through `paper.active`, a version of one of the paper's own copies. A writer sets it last: after the version row, its passages and its objects are in place. Until then a new paper reads as missing, and a publication that fails before that step leaves the previous active version in place.
- Only an admitted copy has versions. A version references its copy together with an admission that can only be `Admitted`, so a restricted, retracted, unidentified or withdrawn copy has none, and a copy cannot lose its admission while it has one.
- A version points to an annotation only if that annotation is of its text and extraction.
- A paper with a metadata-only reason has no active version.

Withdrawing a copy for rights or a retraction therefore runs in this order: clear `paper.active` if it points to one of the copy's versions, delete the copy's objects and versions (their passages go with them), then set the copy's admission to `Withdrawn` with its reason. An annotation stays, since another copy with the same text may point to it.

## Reading

`Papers.read(paper)` answers one of:

- `Text`: the bibliography, the copy, the version, its passages from the text object, and the version's active annotation or none.
- `Metadata`: the bibliography and why the paper has no text.
- `Withdrawn`: the bibliography and why its copy was withdrawn, so an old citation card can say why its quote is gone.

It fails with `PaperMissing` for an unknown paper or one whose publication has not finished, `PaperCorrupt` when the text object is missing, has another hash or does not decode, and `PapersUnavailable` when D1 or R2 fails, a table is missing, or the Worker binds no store.

## Tests

`packages/server/test/papers.ts` fills a test store the way the writers must: `publish` for a paper with text, `list` for a metadata-only paper, `withdraw` for a withdrawn one. Each is valid by default and takes only what a test changes. `packages/server/test/Papers.test.ts` runs the reader against D1 and R2 inside workerd.
