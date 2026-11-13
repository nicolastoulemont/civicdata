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
- A passage that reads as a reference list (dense author initials, years before titles, volumes, page ranges, DOIs) is dropped, so a paper is not found for the titles it cites. On the 502 labelled passages of the corpus fixture (`packages/server/test/fixtures/papers/corpus.json`) the check flags 34 of the 42 reference passages and 6 of the 460 others, mostly tables and title pages.
- Rows group by paper. A paper scores its title's bm25 plus that of its best three passages, and search returns the best ten papers.

Each `Match` is one of:

- `Text`: the bibliography, the copy, the active version (its `id` is the version a demand records), whether that version has an annotation, and up to three passages the words found, best first, each with its physical page and part.
- `Metadata`: the bibliography and why the paper has no text. It never carries a passage.

A match carries no citation and does not decode as the domain's `Paper`. Search never reads an annotation's scope: an unannotated paper is found like an annotated one, and no publication year, affiliation or keyword stands in for a study's period or population. A withdrawn paper or one whose publication has not finished is not found. Search only reads `PAPERS_DB`: it never touches `CATALOG_DB` or the bucket, records no demand and schedules nothing. It fails with `PapersUnavailable` when D1 fails, the tables are missing, or the Worker binds no store.

`packages/server/test/Discovery.test.ts` runs search inside workerd against D1, and against a sample: the eight papers of the corpus fixture, unannotated, and the metadata of the 93 other records the corpus run found (`docs/research/papers/corpus-run.json`). Each of its 12 queries ranks its wanted papers in the first two results.

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

## Annotation

`AnnotateWorkflow` (`packages/server/src/AnnotateWorkflow.ts`, bound as `ANNOTATE`) annotates a list of paper versions. `packages/server/src/research/Annotate.ts` holds its work and `Annotator.ts` its model calls, which the local annotator in `scripts/papers` shares. Like the Catalog and Gather Workflows, it exists only in a stage that owns its paper store: production and previews with the `own-catalog` label. A shared preview binds none. Only production runs it on a schedule, once a day ([daily run](#daily-run)); an `own-catalog` preview runs it only when someone starts a run.

### What a run does

A run first groups its list by annotation key: two versions with identical text share one key, and a version the store no longer holds is `Skipped { Withdrawn }`. Then, for each key, at most 4 at once, it runs these steps:

1. Claim the key.
2. Load: check that a listed version still has the key's text under the current settings and that its text object in `PAPERS` matches its hash.
3. Scope: ask the Responses API for the scope and excerpts, check every quote against its page, and save the scope.
4. Labels: ask the Decisions API to label every passage and excerpt, check that every one has exactly one label, and save the labels.
5. Publish: check the saved scope and labels against the text again, then in one D1 batch add the annotation, mark the key `Ready` and point the versions at it.
6. Finish: give the key back or count the attempt, and record each version's outcome.

Each step is a Workflow step. Its answer is a small JSON value; the scope, the labels and the text stay in `PAPERS_DB` and `PAPERS`, and each step reads them by key or version. A run makes two model requests per paper, one per stage, and none for a stage whose output is already saved: a later run for the same key reuses the saved scope and labels, so a failed classification or publication never repeats the scope call.

A step retries a provider or store failure 3 times, 10, 20 and 40 seconds apart. Invalid output does not retry: malformed JSON, an unknown sentence, an ungrounded quote or period, or missing or duplicate labels fails the paper for this run and counts as an attempt. The checks, prompts and rubric are the local annotator's.

### Daily run

In production, a native Workflow schedule (`0 6 * * *` in `packages/infra/alchemy.run.ts`, no Cron Trigger) starts a `Demand` run every day at 06:00 UTC, an hour after the 05:00 gather. A scheduled instance carries no params, and the Workflow treats it as `Demand`. A question never makes a paper annotate sooner than the next run, which keeps paid work off the request path.

A `Demand` run's first step, `select`, reads `Demand.since` once, for the last 30 days, and filters what it returns against `PAPERS_DB`. A version is listed when:

- a question asked for it in the last 30 days;
- it is its paper's active version, so its copy is admitted and its text is published;
- its annotation key under the current settings is not `Ready`, `Running` or `Abandoned`, and its active annotation is not already that key. A new key and a `Failed` one under the attempt limit qualify.

Versions with no active annotation come first, then versions whose active annotation is under older settings. Within each group, the most asked comes first, then the lower version id. The run then annotates that list as if someone had listed it by hand: it groups the versions by key, takes the first 20 keys, and claims each through the same statement. Everything past a cap, the 20 keys or the 3,000,000 tokens, is `NotStarted` in `annotation_run` and waits for the next run. Demand changes which papers a run annotates, never how many, so production's daily spend stays within one run's caps whatever the traffic.

`select` is a Workflow step, so a replayed or restarted instance lists the same versions and does not read demand again. The run reads key states from `annotation_key`, never from Workflow history, so a `Ready` key is not listed again after Workflows' retention has removed the run that made it. A run with no demand makes no model call and writes nothing; one whose demand lists nothing eligible writes no `annotation_run` row.

A key left `Running` by an instance that ended without giving it back is not listed. A run started by hand that lists one of its versions takes the claim over ([key states](#key-states)).

A run started by hand on the same day, with a list or with `demand`, claims through the same statement, so each key is annotated once. Each such run adds up to one run's caps to the day's spend.

### Key states

`annotation_key` holds one state per key, and only this Workflow writes it:

| State       | Meaning                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Running`   | the run in `run` holds the key                                                                                                     |
| `Ready`     | the run in `run` published the annotation, or found one the publication command imported                                           |
| `Failed`    | a run gave up after `attempts` attempts, or gave the key back as stale or withdrawn; a run may claim it while attempts are below 3 |
| `Abandoned` | three runs failed; only a run started with retry claims it                                                                         |

A run claims a key with one `INSERT ... ON CONFLICT DO UPDATE ... WHERE` statement, which succeeds only if the key is new, `Failed` under 3 attempts, already `Running` under this run (a claim step that Workflows retried after its write landed), `Running` under a run whose instance has ended, or `Abandoned` on a retry. Before taking another run's claim over, the run asks the Workflow API for that instance's status: a running, waiting or paused instance keeps its claim however old it is, and an instance the API no longer knows has ended. Two runs with overlapping lists therefore annotate each key once.

A claim is checked where it is used. Every step that calls the model reads the key's state first and stops if another run holds it, and every write carries `WHERE run = ?` and treats no changed row as a lost claim. An errored instance restarted after another run took over its claim stops at its next model call or write without spending. A lost provider response can still repeat one paid call; the saved stages and the attempt limit bound that.

### Outcomes

Each run records one row per listed version in `annotation_run`: its outcome, the key's attempts after the run, when the run claimed and finished the key, and the model requests and tokens the provider reported. It holds no prompt, answer or key. The outcome is one of:

- `Annotated { key }`: the key is `Ready`, by this run or an earlier one. A key whose annotation the publication command imported becomes `Ready` on its first claim, with no model call.
- `Failed { stage, reason, problem }`: a stage gave up with `Invalid` output, `Unavailable` source text, a `Provider` that kept failing, or a `Store` that kept failing. All but a failed claim count as an attempt.
- `Skipped { reason }`: the text or the settings changed since the key was computed (`Stale`), the version was `Withdrawn`, another run holds the key (`Held`), or the key is `Abandoned`. None of these is an attempt.
- `NotStarted`: the run reached a cap before claiming the key.

### Caps

`Limits` in `Annotate.ts` holds every cap: 20 keys per run, 4 at once, 3 attempts per key, and 3,000,000 tokens per run. Once the tokens the provider reported reach the cap, the run claims no new key, and the rest are `NotStarted`.

No usage record exists for the eight papers annotated locally: the expanded corpus run did not measure tokens ([retrieval notes](research/papers/retrieval/README.md)). The cap is an estimate from their size instead. The eight papers have 502 passages of at most 300 words, about 400 tokens each. The scope request sends a paper's text once, and the classification request sends it twice, plus about 170 tokens of choices per question. The largest paper, 90 passages, needs about 130,000 tokens, so 20 such papers need about 2.6 million. The Decisions API may report no usage; a run then counts only the scope requests' tokens. Replace the estimate with the recorded usage once runs have filled `annotation_run`.

### Active annotation

A version points to one active annotation (`version.annotation`). Publication points every version with the key's text and extraction at the new annotation, and the statement itself requires that the key is `Ready` and the annotation's model and rubric are the current settings (`Settings` in `annotation.ts`). Changing the model or rubric gives every paper a new key, and its annotation under the older settings stays active until the replacement is ready or someone retires it. A run never points a version at an annotation under other settings, so a run restarted after a settings change finds its keys `Stale` and publishes nothing. `Papers.read` serves the active annotation.

### Start a run by hand

Run the `Annotate papers` GitHub workflow with the stage, the version ids and a command, from the Actions tab or with:

```sh
gh workflow run annotate.yml -f stage=pr-123 -f versions="<version> <version>"
```

It refuses a pull request without the `own-catalog` label. From a machine with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set:

```sh
pnpm --filter @repo/server run annotate --stage pr-123 <version> <version>
```

A version's id is `version.id`. Each run costs up to two model requests per listed key, so list only the versions that need an annotation.

To run the daily selection now, for example on an `own-catalog` preview, which has no schedule, or to retry a scheduled run that failed, use the `demand` command with no versions:

```sh
gh workflow run annotate.yml -f stage=pr-123 -f command=demand
pnpm --filter @repo/server run annotate --stage pr-123 --command demand
```

A preview's demand comes from questions asked on that preview, in its own `DB`. A failed scheduled instance can also be restarted from the Cloudflare dashboard: its saved steps, the selection among them, replay.

### Retry an Abandoned key

Start a run with the `retry` command, or `--command retry`, listing a version of the key. That run may claim the key's `Abandoned` state and resets its attempts to 0. It reuses the key's saved scope and labels; a person who wants new ones deletes the key's `annotation_stage` rows first.

### Retire an older annotation

Start a run with the `retire` command, or `--command retire`, listing the versions. It clears each listed version's active annotation when that annotation is under settings other than the current ones, and leaves a current one in place. The annotation row stays, as a withdrawal leaves it.

### Read run outcomes

The Workflow instance's output lists each version's outcome: the Cloudflare dashboard shows it under Workers & Pages, Workflows, and the API returns it at `/accounts/<account>/workflows/civicdata-<stage>-annotate/instances/<id>`. A scheduled instance's id is Cloudflare's; the dashboard lists it with its start time. The stage's `PapersDatabase` keeps the outcomes after the instance is gone:

```sql
SELECT version, json_extract(outcome, '$._tag') AS outcome, outcome AS detail, attempts,
  requests, input_tokens, output_tokens, started_at, ended_at
FROM annotation_run WHERE run = '<instance id>';
```

To see what each recent run did and spent, newest first:

```sql
SELECT run, min(ended_at) AS ended, count(*) AS versions,
  sum(json_extract(outcome, '$._tag') = 'Annotated') AS annotated,
  sum(json_extract(outcome, '$._tag') = 'NotStarted') AS waiting,
  sum(requests) AS requests, sum(input_tokens) + sum(output_tokens) AS tokens
FROM annotation_run GROUP BY run ORDER BY ended DESC LIMIT 10;
```

Demand lives in the stage's `DB`, not `PapersDatabase`: read it with the query under [Demand](#demand), with `-30 days` for what the next run considers.

`packages/server/test/Annotate.test.ts` runs the Workflow's work against D1 and R2 inside workerd, with OpenAI faked on the wire and a fake Workflows step runner that saves, replays, retries, loses and crashes steps. Its `Demand` runs read the real demand record in the test's `DB`.

## Conversations

`search_papers` in `packages/server/src/Agent.ts` asks `Library.search` (`packages/server/src/research/Library.ts`), which reads only the store: it runs `Discovery.search` on the question's words, then `Papers.read` for each match whose version has an annotation. The Worker bundles no paper: the corpus that used to ship as `corpus.json` is now a test fixture, and a stage answers from whatever its store holds.

The lookup answers, per paper, one of:

- `Evidence`: a passage of the version's active annotation, as the domain's `Paper`, with its copy, page, hash, version and licences. It passes the same gates as before: the annotation's scope covers the question's countries and years, a cause needs an author-reported causal estimate in both result and design, and the quote is exact text from its page. Only evidence and the reviewed findings get citation ids, and Support still checks each sentence that cites one.
- `Reading`: a match with no annotation, including a metadata-only paper. It has no scope: its publication year and publisher never stand in for the years or people a study covers. It gets no citation id, so words that cite it are dropped, as words citing any record the answer did not look up are.

It answers `NoEvidence` when it found neither. An annotated paper whose annotation gives no passage for the question is neither evidence nor reading.

The model receives evidence passages as before, and of the readings only how many the answer shows, as `suggested`. It never receives a reading's title or text: paper text is untrusted, and keeping unreviewed text out of the prompt is the one check that rests on no model judgement. Code shows up to three readings under the answer, as a `Readings` block labelled as not reviewed, with each paper's title, authors, year, source link, and for an admitted copy its reuse licences and the passage search matched. A turn saves the block with the answer, and the model never sees it.

After each lookup, the answer records demand for up to three readings with admitted text, highest-ranked first, through `Demand.record`. The write has a one-second timeout; a failure or a timeout is logged as a warning and the answer goes on. A conversation never starts a Workflow or calls the annotation model: it only reads `PAPERS_DB` and `PAPERS` and writes demand to `DB`. A paper the annotation run annotates since is evidence for the next question that finds it; answers already given stay as they were.

Model requests per answer are unchanged: the rounds of the answer, plus one support review per text block.

### Withdrawn citations

A citation keeps the store's id of the copy it quotes (`copy` on the domain's `Paper`). When a conversation's turns load, `Papers.withdrawn` reads which of the cited copies were withdrawn, in one query, and each such citation shows as `Withdrawn`: its study and the withdrawal reason, without the quote or the context. Before the next question, the agent replaces each withdrawn passage in the model's history with its id and the reason. The words the agent wrote stay as written, in the turn and in the history. A store that cannot answer leaves the citations as saved and logs a warning. Citations saved before the store have no copy id, and show as saved.

### Rollout and previews

A stage answers from its own store, which starts empty: until a publication fills it, every lookup answers `NoEvidence` and no reading is shown. Production's store already holds 201 papers, 8 with text and annotations and 193 metadata-only, so production answers with evidence from those 8 and suggests the rest as reading from its first deploy.

A `pr-<n>` preview without the `own-catalog` label, and `alchemy dev` without `OWN_CATALOG=true`, read production's `PAPERS_DB` and `PAPERS` ([bindings and stages](#bindings-and-stages)), so they show production's evidence and readings. Their demand goes to their own `DB`, never production's. A preview with the label reads its own empty store until someone publishes to it.

`packages/server/test/conversation.test.ts` runs these paths through the conversation's API inside workerd, with the model scripted and the store filled by `test/papers.ts`: evidence from an annotation, cold matches, no match, a demand write that fails or hangs, a paper annotated between two questions, and a withdrawn citation in a saved turn. Its scripted model fails any request other than an answer's round or a support review, so a test that called the annotation model would fail. These tests do not show how a real model treats the count of readings; that rests on the instructions until an eval covers it.

## Tests

`packages/server/test/papers.ts` fills a test store the way the writers must: `publish` for a paper with text, `list` for a metadata-only paper, `withdraw` for a withdrawn one. Each is valid by default and takes only what a test changes. `packages/server/test/Papers.test.ts` runs the reader against D1 and R2 inside workerd.
