# Research in answers

The assistant uses two sources: the existing reviewed findings below, and the
paper store ([docs/papers.md](../../../../docs/papers.md#conversations)).
Answer requests read the store without downloading or annotating papers. A
paper with an annotation gives evidence; one without is only suggested as
reading, and the model never sees its text. See [the build and quality
runbook](../../../../docs/research/papers/expanded/README.md).

`Library` returns original source passages, study population, countries, periods,
methods and limitations where identified. Descriptions and associations do not
justify causal wording. A causal passage requires both a causal result label and
an author-reported identification strategy; this records the authors' estimate,
not proof that their assumptions hold.

`Support` checks every generated text block before it is rendered, including
answers where the generator skipped research tools. Chart-only explanations pass
through the same check. The judge identifies non-research observations and checks
research claims against their citations. Code rejects missing verdicts, missing citation links, invented
evidence indices and causal claims backed only by descriptive or associative
paper evidence. An uncertain judgement or provider failure removes the block and
shows a verification notice. Rejected text is also removed from model history.
The checker is a model judgement, not a guarantee of scientific correctness.
This also catches uncited research claims after an empty lookup; the generator's
instructions alone are not the gate. Every text block adds one support-model
request, bounded to 20,000 characters, 64 sentences and 30 seconds. Descriptive
chart prose is classified as non-research here; its figures are not checked by
this judge.

Paper text is untrusted input. It stays in source excerpts and quotes; it never
becomes an instruction or an automatically accepted causal finding. Adding a
source does not require a per-paper human approval step. Rights proof, exact-copy
identity, input hashes and complete annotations are required before packaging.
Source audits and labelled quality samples test those rules.

The `Paper` citation is separate from `Finding`. It preserves the source quote,
physical PDF page, SHA-256, copy version, bibliography and licence. Citation cards
show evidence kind, study population, scope, source text, available methods and
limitations, version and links to the page and reuse licence. A missing limitation
is shown as missing, never as an assertion that the paper has no limitations.

## Legacy findings, reviewed by hand

`assets/findings.json` holds the findings the agent may cite when it says why a figure moved. `Findings.ts` decodes it with the domain's `Finding` schema and `find_research` reads it. Nothing here is fetched at runtime.

A finding is one research result, in our own words, with the studies behind it:

- `name` reads inside a sentence: "Studies of the euro crisis found larger fiscal multipliers than forecasters assumed".
- `claim` is one or two of our sentences. It quotes no paper.
- `indicators`, `scope`, `from` and `to` say what it explains: the indicator codes of every source that measure it, the countries (or the world) and the years the studies cover. `find_research` returns a finding when the chart's indicator is one of its codes, one of the chart's countries is in its scope, and the years overlap.
- `evidence` says how settled it is. `Agreed` takes two or more studies and no study in this file disputing it. `Single` is one study, not yet replicated. `Disputed` lists the studies on each side and, in `objection`, what the disputing studies found instead.

Each study has its authors ("Last, First", or an organisation's name), year, title, publisher or journal, DOI and the URL of a copy anyone can read. All of them describe the version the URL links, usually a working paper. The DOI is null unless it is printed in that copy or resolves at doi.org to it.

## How each finding was reviewed

Every study was downloaded from the free copy its URL links and read: the introduction, the results the claim rests on, and the conclusion. No study is cited from memory or from its abstract alone. For each study, the pull request that added it lists the passage and page that support the finding, so a reviewer can check the claim against the paper. A study with no free full text was dropped, and a finding left without the studies its state needs was dropped with it.

The file stores no paper text: only our wording and bibliographic data.

## Adding or changing a finding

1. Download the study from a copy anyone can read and read it.
2. Write the claim in your own words, no stronger than the paper's own conclusion. Set `scope`, `from` and `to` to what the study covers, not to what the claim might extend to.
3. Pick the state from the rules above. When a new study disputes an `Agreed` finding, the finding becomes `Disputed`.
4. In the pull request, add each study's supporting passage and its page.
