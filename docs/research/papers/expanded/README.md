# Paper evidence in answers

Steps 1–4 now run locally: a larger licensed corpus, passage-quality checks,
sentence-support checks, and assistant retrieval with citation cards. The corpus
is packaged with the server. Production D1 storage, indexing and scheduled
refresh are separate work; this change does not deploy them.

## Corpus and source evidence

The [manifest](manifest.json) lists eight retained papers, 266 physical PDF pages,
502 original passages and 107 selected source sentences. The previous three
papers remain. Five additions cover EU minimum-wage growth, German disability
pensions, Britain's carbon tax, Spanish fiscal consolidation and biases in fiscal
multiplier estimates. Eleven discovery queries produced candidates; the archive
contains 201 distinct records, including explicitly audited copies.

All eight retained copies have copy-specific CC BY 4.0 evidence. Each keeps its
bibliography, identified URL, version, PDF SHA-256, physical page numbers,
retrieval date and licence proof. The [source audit](source-audit.json) also keeps
excluded noncommercial rights and unavailable copies. A timeout or 403 does not
lead to an access-control workaround or text admission. OpenAlex licence labels
alone do not retain text.

Britain's carbon-tax study supplies accepted author-reported causal results and
regression-discontinuity-in-time methods. The Spanish study uses synthetic
control, but its selected null-result passages did not receive an accepted causal
result label. It therefore answers descriptive evidence queries and abstains on
causal queries at the current threshold. The pension paper is a calibrated
simulation, not empirical causal identification. A final audit found an incorrect
causal scope label and changed it to Unknown; the [correction](scope-correction.json)
preserves the original output and reason. Its result labels already prevented
causal retrieval. That scope error is outside the passage accuracy count.

[Metadata corrections](metadata-corrections.json) record three publication-name
and request-URL fixes from already-fetched metadata. The source text and PDF
hashes were unchanged, so completed annotations were rekeyed without another
model call. Original extraction artifacts, including broken hyphenation, are
retained. Control-glyph passages are excluded from primary evidence.

## Annotation and measured quality

Rubric `research-3` uses `gpt-6-luna`: one structured scope/sentence-selection
request and one classification batch per paper. Scope evidence selects existing
numbered source sentences. Code checks every quote against the physical page,
checks period endpoints, and requires complete original-passage and selected-
sentence labels. It never accepts a generated paraphrase as a source quote.
Methods and limitations can be selected as short sentences from mixed passages.

The [32 passage labels](labels.json) were written before this annotation run,
separately from the previous 12 development labels. One reviewer supplied the
labels. Calibration and holdout passages share papers, so this is neither an
inter-rater study nor a test on unseen papers. The [benchmark](benchmark.json)
records:

- Calibration: 15/17 labels correct; 10 accepted at confidence 0.9, all correct.
- Holdout: 13/15 correct; 3 accepted at confidence 0.9, all correct.
- Overall: 28/32 correct. The four errors have confidence 0.29–0.63 and are
  excluded at the retrieval threshold. These counts do not establish confidence
  calibration or general scientific accuracy.
- All 19 development retrieval questions pass, including unsupported countries,
  periods and causal claims. These fixtures were used during development and
  are not an independent retrieval evaluation.

The four passage errors concern a Spanish null-result conclusion, a mixed
Spanish method/result passage, EU wage-regression discussion and an unreadable
British table. Their original labels and model outputs remain in the report.
Porter stemming and title context improved lexical coverage without relaxing
country, period or causal gates. Retrieval requires all topic terms across the
passage and title, at least two in the passage, and confidence at least 0.9.
It returns one primary passage per paper, at most three, with identification
methods and nearby accepted method/limitation context. Missing limitations stay
explicitly missing.

## Assistant and sentence support

`search_papers` searches the packaged corpus without network or annotation calls.
It returns source passages and registers citation IDs alongside the existing
15 reviewed findings. Paper citations keep original source wording; reviewed
findings keep their existing authored wording. Neither path changes chart data.

Before rendering any generated text block, `Support` asks the configured
assistant model to judge each numbered sentence. This includes rounds with no
research tool call and chart-only explanations. The judge checks country,
period, population, outcome, direction, magnitude and available caveats. A
research sentence must link its evidence. Code rejects missing/duplicate reviews,
unknown evidence indices, absent links, and causal wording unless both paper
result and design are AuthorCausalEstimate. Unsupported or uncertain support,
malformed output and provider failure withhold the text and show a verification
notice. Rejected prose is removed from the saved answer and future model context;
charts remain. Raw provider output may remain in short-lived traces as described
in [the trace contract](../../../traces.md).

This adds one structured model request per text block, with a 30-second timeout,
20,000-character bound and 64-sentence bound. It uses the configured assistant
model, currently defaulting to `gpt-6-luna`. The check is model judgement, not a
proof of correctness. Descriptive chart prose is classified as non-research;
this checker does not verify numbers against observations.

Tests exercise the real provider adapter with recorded HTTP responses, backend
conversation persistence and future context, and an MSW-backed citation-card
interaction. They establish the protocol and failure behavior. No paid assistant
eval or probe was run, and real-model sentence-support accuracy remains unmeasured.

Citation cards show the evidence kind, population, country/period scope, exact
source passage, method and limitation context with page numbers, copy version,
and links to the physical PDF page and licence. Bibliography, PDF hash and source
quote remain in saved citation data. Existing locale catalogs supply the labels.

## Build, search and replay

From the repository root, with dependencies installed:

```sh
# Fetch new discovery units and retry unresolved copies locally.
pnpm --filter @repo/server run papers
# Audit-listed copies with DOI and exact-copy licence checks.
pnpm --filter @repo/server run papers:intake
# Refresh explicitly rechecks completed source records.
pnpm --filter @repo/server run papers:intake --refresh

# Requires OPENAI_API_KEY; sends retained licensed text to OpenAI.
# Completed matching annotations resume without a model call.
pnpm --filter @repo/server run research --annotate

# Saved annotations only, no model or network.
pnpm --filter @repo/server run research --check
pnpm --filter @repo/server run research --query 'causal carbon tax emissions Britain'
pnpm --filter @repo/server run research --query 'fiscal consolidation economic growth Spain'
# Verify records/PDF hashes and atomically replace the server's packaged corpus.
pnpm --filter @repo/server run research --pack
```

All three scripts default to `.papers/corpus-v4`. `papers` takes `--output`;
`research` and `papers:intake` take `--corpus`. Intake reads [sources.json](sources.json)
by default; `--sources` selects another audited list. Each entry identifies DOI,
copy URL, record URL and version. Intake requires matching DOI metadata and DOI
text in the PDF. EconStor uses exact-item rights; other audited copies must prove
the licence in the PDF. Refresh removes active text when a work is retracted or
rights fail. As with the original gather, one writer owns a corpus directory.

The archive includes all metadata records, discovery receipts, eight retained
PDFs, attribution and only the eight current completed annotations. It is the
`corpus.tar.gz` asset of the
[`papers-corpus-v4` release](https://github.com/nicolastoulemont/openfacts/releases/tag/papers-corpus-v4),
kept out of Git; [corpus.sha256](corpus.sha256) holds its SHA-256. It contains
source text; retain its attribution when redistributing it.

```sh
mkdir -p .papers/v4 .papers/replay-v4
curl -fL -o .papers/v4/corpus.tar.gz \
  https://github.com/nicolastoulemont/openfacts/releases/download/papers-corpus-v4/corpus.tar.gz
(cd .papers/v4 && shasum -a 256 -c ../../docs/research/papers/expanded/corpus.sha256)
tar -xzf .papers/v4/corpus.tar.gz -C .papers/replay-v4
pnpm --filter @repo/server run research --corpus "$(pwd)/.papers/replay-v4" --check
pnpm --filter @repo/server run papers:intake --corpus "$(pwd)/.papers/replay-v4"
```

The [fresh replay receipt](replay.json) records matching benchmark output,
zero network attempts and zero changed files for checks, annotation resume and
intake resume. Annotation resume still loads key configuration, but makes no
model request when all saved annotations match. The replay used a dummy key and
a fetch guard that rejects and counts any attempted request. Discovery retries
unresolved copies on a normal run; these failures are not the offline quality
check's exit status.

## Attribution and remaining work

Authors, titles, publishers, source URLs and licence notices are preserved in the
manifest and archive's `ATTRIBUTION.md`. Extraction normalises whitespace and
splits physical pages into passages/sentences. Scope, labels and ranking are our
annotations, with the explicit scope correction above. Authors and publishers
do not endorse them.

Coverage remains narrow: eight papers do not establish a literature consensus.
Lexical English retrieval misses paraphrases and non-English questions; tool
callers can supply explicit country and period filters. The quality sample is
small, scope extraction can err, and support-model accuracy needs an explicitly
authorized real-model evaluation. Production storage, scalable indexing,
scheduled gathering and deployment remain step 5.

## Verification

`pnpm check` passed after the final changes: formatting, lint, lint-plugin tests,
Fallow, workspace typechecks, 964 tests and the production build. A separate
`turbo run typecheck test build` also passed. The changed-code Fallow audit found
no dead code, duplicate groups or complexity findings in this change; it warns
about the deliberate lint suppression used to detect corrupt PDF control glyphs. The repository-wide scan still reports two duplicate
code groups in unchanged FAOSTAT/IMF/WID adapters. No paid assistant eval, probe,
push or deployment was performed.
