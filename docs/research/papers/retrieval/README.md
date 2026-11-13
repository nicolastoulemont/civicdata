# Local research retrieval

This is the historical three-paper checkpoint. See the [current runbook](../expanded/README.md)
for the eight-paper corpus, current CLI defaults and assistant integration.

This slice annotates the three retained papers and searches their own results
locally. It does not change the assistant's tools or its 15 reviewed findings.
Production storage, scheduling, answer support checks and citation cards remain
separate work.

## Run

From the repository root, with dependencies installed:

```sh
# Requires OPENAI_API_KEY. Sends the licensed paper text to OpenAI.
pnpm --filter @repo/server run research --annotate

# Uses saved annotations. No API key, model call, network or writes.
pnpm --filter @repo/server run research --query 'democracy income inequality Indonesia'
pnpm --filter @repo/server run research --query 'causal effect democracy economic growth Indonesia'
pnpm --filter @repo/server run research --check
```

The default corpus is `.papers/corpus-v3`. Use `--corpus /absolute/path` to read
another directory. Query filters can be explicit:

```sh
pnpm --filter @repo/server run research --query 'minimum wage job satisfaction' --country IRL --from 2018 --to 2018
```

Repeat `--country` for multiple ISO alpha-3 countries; all must be covered.
Supply both `--from` and `--to`. The requested interval must fit inside a recorded
study period. Study periods describe the paper's analysis, not every estimate in
it. Read the attached scope evidence before applying a result to a year.

Inference recognises canonical country names, literal four-digit years and
English causal terms such as “why”, “effect” and “impact”. Use explicit country
filters for aliases or adjectives. `--cause` also requires a causal design.
Queries use English lexical matching, with a small stop-word list and plural
normalisation. All remaining topic terms must occur in a candidate; country
terms are handled by the scope filter. Synonyms and paraphrases can be missed.

Only one writer should annotate a corpus at a time. The annotator pins
`gpt-6-luna` and rubric `research-2`. A completed paper needs one Responses request
for scope and sentence selection and one Decisions request for classification.
There are no automatic retries; each request has a three-minute timeout. Papers
with more than 400 combined passages and selected sentences fail before the
classification request. Scope checkpoints survive classification failures.
Completed annotations resume without requests or writes. The model name is an
alias; saved outputs provide reproducibility of these results. Token usage and
billed cost were not measured.

## Offline replay

The [fresh replay receipt](replay.json) records zero network attempts and zero
changed files for both search checks and annotation resume. `pnpm check` and the
changed-code Fallow audit passed. The papers suite has 31 passing tests, including
six tests for annotation, retrieval and failure handling.

The original corpus archive ([`papers-corpus-v3`](../README.md#packaged-offline-corpus)) supplies the exact licensed PDF
snapshots and extraction records. This folder adds three completed annotations.
The [manifest](manifest.json) records their papers, authors, rights evidence,
PDF hashes, provider versions through the original records and annotation files.

The v3 corpus archive is kept outside Git and published nowhere: the owner
supplies it by hand. Put it at `.papers/v3/corpus.tar.gz`; the first command
checks it against the committed SHA-256 before anything reads it.

```sh
mkdir -p .papers/retrieval-replay/annotations
(cd .papers/v3 && shasum -a 256 -c ../../docs/research/papers/corpus.sha256)
tar -xzf .papers/v3/corpus.tar.gz -C .papers/retrieval-replay
cp docs/research/papers/retrieval/annotations/*.json .papers/retrieval-replay/annotations/
pnpm --filter @repo/server run research --corpus "$(pwd)/.papers/retrieval-replay" --check
```

Search verifies every retained PDF hash, decodes records and checks annotations
against their input hash, model and rubric. Missing, corrupt, incomplete or stale
annotations fail the operation. They do not produce an empty search result.
Input hashes cover the whole paper record, model and rubric. A refresh that
changes a record requires annotation of that new input.

## Evidence returned

Passages carry a description, association or author-reported causal estimate
label and the provider's raw confidence. The default threshold is 0.9; it is a
conservative development setting, not a calibrated probability of correctness.
Fixed effects alone count as association. Causal queries require both a paper
with an author-reported identification strategy and a matching causal passage.
None of these three papers passes that causal gate.

The extractor chooses numbered source sentences for findings, country evidence,
period evidence and study design. The tool resolves those numbers to stored
text. Unknown sentence references fail. Period evidence must contain both years.
No generated quote can become a citation. A second request classifies every
original passage and selected result sentence. Missing, duplicate, refused or
malformed answers fail the paper. Literature and references are excluded from
primary results. Adjacent, accepted sentences of the same category can be joined
only when their exact concatenation exists on the same source page. This keeps
pronouns with their antecedents.

Ranking uses inverse document frequency and a length adjustment. Results contain
at most one primary passage per paper, up to three papers. Each contains the
bibliography, native copy ID, provider-reported version, content ID, PDF hash,
snapshot filename, physical PDF page, source URL and licence evidence. `part` is
null for selected or joined sentences; the quoted text and physical page identify
those spans. Nearby confidently classified methods or limitations accompany the
result when available. Their absence does not establish that a study has no
limitations. Classification and extraction can miss caveats or misread a study.
PDF chunk boundaries can leave fragments in the stored extraction.

`NoEvidence` distinguishes absent country/period coverage, absent causal-design
coverage and no matching accepted result. It describes this corpus and retriever.
The tool returns source passages without generating an answer or asserting that
they support a particular sentence. That support check remains part of NTO-228.

## Measured results, 12 November 2026

The [benchmark](benchmark.json) searches 186 passages plus 24 selected sentences
across three papers. All 14 development questions pass: six covered questions
return relevant papers and eight unsupported questions return `NoEvidence`.
The broad Ireland incidence question permits both studies, which concern
different populations: employees and advertised vacancies. Their titles and
source text preserve that distinction.

The [12 source labels](labels.json) were written before annotation. The final
classifier matches 6/6 calibration labels and 5/6 holdout labels. At the 0.9
threshold it accepts 4/6 and 3/6 respectively, with no accepted mistakes in this
small sample. One mixed limitations passage is labelled Other. These labels
were reused during development; “holdout” identifies the original split, not an
independent final evaluation. They do not establish production accuracy or
confidence calibration. `--check` exits 1 for a wrong retrieval outcome or an
accepted label mistake and prints the full diagnostic report.

The [first run](first-run.json) scored 12/14 retrieval targets. It missed both
Indonesia questions because mixed chunks had low confidence and its accepted
regression tables lacked the query terms. Short source sentence selection and
adjacent-sentence context recovered those results. Requiring every topic term
also removed an unrelated vacancy-paper match for job satisfaction. The original
incidence fixture expected only the employee paper; the final fixture records
both relevant papers rather than treating a different population as the same
estimate. These are development checks, not a blinded retrieval evaluation.

Development included three rejected scope extraction requests where generated
quotes failed the grounding check. Sentence references replaced generated quotes
for every evidence field. The original six-call pass and final six-call pass are
separate model annotations; no assistant eval or probe was run.

## Gaps and next source work

There is still no accepted causal-design evidence in this corpus. Fiscal
multipliers, pension reform, carbon taxes and literacy are also uncovered.
First expand topical discovery through EconStor's identified repository records,
where copy-specific rights proof already works, and audit new records for causal
identification and redistribution rights before adding an adapter. This is a
priority for the next source audit, not a claim that any uninspected paper meets
the gate. More ESRI vacancy reports would deepen the existing descriptive niche.

Before enabling research in answers, add a larger independently labelled sample,
retrieve useful limitations from mixed passages, check each generated sentence
against its cited evidence, and show the study's population and design beside the
citation. Production D1/indexing and scheduled refresh remain outstanding.

## Attribution

The annotations include excerpts from the three CC BY 4.0 copies listed with
authors, titles and URLs in [manifest.json](manifest.json). The original PDFs and
rights notices are in the corpus archive. Text extraction normalises whitespace
and splits pages into passages and sentences; labels, scope and ranking are
machine-generated annotations. These changes are ours. The original authors and
publishers do not endorse the annotations. Retain the manifest and attribution
when redistributing these excerpts.
