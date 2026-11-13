# Research corpus pilot

The current [eight-paper corpus and assistant integration](expanded/README.md)
complete local steps 1–4. The measured three-paper run below is historical.

[NTO-224](https://linear.app/ntoulemont-personal/issue/NTO-224) now has a bounded
local discovery and gathering pipeline. It finds candidate documents, identifies
copies, records licence evidence, and retains admitted PDFs and page-bound text.
The current assistant searches the paper store with `search_papers`;
`find_research` continues to serve the existing reviewed findings.

## The measured run

The [run report](corpus-run.json) records five searches with 20 results each:
minimum wages and employment, fiscal multipliers, pension reform and employment,
democracy and economic growth, and a search restricted to EconStor across those
topics. Searches are English, open-access records from 1990 onwards, excluding
records OpenAlex marks as retracted. There are 96 distinct OpenAlex work IDs;
four repeated search hits are deduplicated. Ten candidates have no DOI and still
enter the gather through their OpenAlex ID.

The run retained three documents, 130 physical PDF pages and 186 passages:

| Document                                                                                              | Copy retained                        | Licence evidence                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| A comparative assessment of minimum wage employment in Europe, ESRI Research Series 123               | ESRI PDF, 70 pages                   | PDF page 2, CC BY 4.0                                          |
| A study of minimum wage employment in Ireland using online job vacancy data, ESRI Research Series 209 | ESRI PDF, 46 pages                   | PDF page 2, CC BY 4.0                                          |
| Democracy, economic growth, and income inequality: Evidence from province level data                  | EconStor item 10419/304100, 14 pages | Item metadata naming the exact PDF, plus PDF page 1, CC BY 4.0 |

The other candidate outcomes are mutually exclusive:

- 32 have no identified HTTPS PDF copy with a recognised version label.
- 50 did not establish an admitted licence under this pilot's policy.
- Two PDFs lack sufficient licence evidence.
- Nine remain unresolved because their available copies fail to download or
  return HTML instead of a PDF. The receipts preserve 403, 404 and non-PDF
  responses; the gather does not work around access controls.

One admitted document first encountered a blocked publisher URL and then
succeeded through its separately identified EconStor copy. There are ten failed
copy attempts across nine unresolved candidates and that successful fallback.
These are availability outcomes, not judgments about scientific quality or
whether every excluded document could lawfully be reused.

The fresh run took 11.3 seconds on this machine with two concurrent papers and
25 application-level HTTP requests, excluding redirects inside fetch. It made
five OpenAlex search calls and used direct source copies, not OpenAlex's paid
content API. At the [published search rate](https://help.openalex.org/api/searching/)
of $1 per 1,000 calls, those searches represent $0.005 before free allowances.
This is a nominal API estimate, not a billing measurement. There were no OpenAI
calls, tokens, embeddings or model charges. Setup, tests and independent PDF QA
are outside that timing.

[Offline replay](corpus-replay.json) used zero requests and wrote zero records.
[A normal resume](corpus-resume.json) made nine requests, retrying only unresolved
copies, and wrote zero records because their outcomes remained unchanged.
The command exits 1 while unresolved candidates remain, after processing the
rest. Completed metadata exclusions and admitted documents remain available.

## What licence evidence means here

[OpenAlex availability](https://help.openalex.org/data/works/open-access/) and its
licence label are discovery hints. A label alone cannot retain text. The pipeline
requires an admitted licence notice in the PDF's first two pages, or a supported
repository's item-level licence record tied to the exact PDF. An explicit
restriction or conflicting licence evidence prevents admission.

The first page adapter supports EconStor. It checks the final response host and
item path, the native repository handle, `DC.identifier`, `citation_pdf_url` and
`DC.rights`. A website footer or a licence for another item or PDF is insufficient.
A matching item licence can admit text even if OpenAlex supplies no licence label
or the PDF has no licence URL. Page and PDF evidence preserve their URL, retrieval
time and hash. Pages are parsed without executing scripts or loading resources.

The admitted licence set remains CC BY, CC0 and public-domain mark. Other
licences, including noncommercial and share-alike licences, await a separate
policy. This is a conservative automated screen, not a legal determination.
Publisher PDFs with matching notices work; arbitrary publisher landing pages and
other repository formats do not yet have adapters.

## Versions and source quality

Work IDs group search results. A retained copy keeps its native location ID,
its own DOI when supplied, exact requested and resolved URLs, source-reported
version, raw PDF hash, and a content ID tied to that identified snapshot. Related
copies are not merged into one text. Different work IDs sharing a DOI are not
silently collapsed. At most three identified copies are checked per work,
prioritising copies with an admitted catalogue label or a supported repository.

Version labels remain provider claims. OpenAlex labels the retained EconStor
copy `submittedVersion`, but its PDF includes a repository cover and a
journal-formatted article. The corpus does not turn that label into a claim about
peer review or publication status. Catalogue author metadata can also include
institutional names or duplicates. Original attribution stays in the PDF;
[the archive](#packaged-offline-corpus) includes an attribution and changes notice.

One repository returns different PDF bytes on successive downloads of the same
URL. The corpus therefore retains the exact admitted PDF snapshot alongside its
text and verifies that snapshot's hash on read. A later download is not evidence
that the original bytes matched. Refreshes can replace the active snapshot; this
pilot is not a historical version archive.

The [extraction QA report](qa/extraction.json) verifies all three retained hashes
and physical page counts with Poppler. Nine sampled pages, covering licence
notices and later content, have complete reference-token coverage against
`pdftotext -layout`. That comparison ignores order and multiplicity. It does not
certify tables, reading order or scientific conclusions. The ESRI 209 cover has
text from an older report in both parsers' output; extraction retains source
artifacts rather than repairing them silently.

There is no empirical-study triage, section classification or finding extraction
yet. Reports, articles and preprints are candidates, not approved causal evidence.
Passages include cover pages, qualifications, methods, results and references.
They contain at most 300 words and never cross a physical PDF page. Scans are not
OCRed. Countries and years studied have not been inferred from author affiliations
or publication dates.

## Run and replay

The `papers` command that gathered this pilot into a folder is gone. The
gather, `papers:gather`, now writes papers straight into a stage's paper store
([gather](../../papers.md#gather)). This section records how the folder gather
worked.

It wrote `.papers/corpus-v4/`, ignored by Git, or the directory `--output`
named. `--seeds` selected the original 36 reviewed study records instead of
topic discovery. Only one writer could use a directory. Standard output was
JSON and contained no paper passages.

Each search query has its own atomic checkpoint. A failed query does not cause
successful queries to run again. Each paper keeps completed copy exclusions and
failed-copy receipts; resume retries failures without redownloading completed
copies. Refresh rechecks discovery, page evidence and PDFs. Unchanged receipts
write nothing apart from refreshed search checkpoints. Dynamic source bytes or
licence-page hashes can create a new receipt even for the same URL.

PDF snapshots publish before their JSON record. A read rejects corrupt JSON,
missing snapshots and hash mismatches without silently refetching. Downgrading
an active paper to metadata removes its active snapshot. There is no historical
snapshot retention yet. Downloads are limited to 20 MiB and 15 seconds, evidence
pages to 2 MiB and 10 seconds, and PDFs to 200 pages. Parsing runs locally without
a separate CPU or memory sandbox. The parser dependency is pinned.

The original [36-study report](pilot.json) remains historical evidence for the
seed-only prototype. Current records use format 3 and do not decode those older
prototype records. The original [source audit](#source-audit) still applies.

### Packaged offline corpus

The archive contains the three licensed PDF snapshots and their text, 93
metadata-only records, discovery receipts and attribution. It is kept outside
Git and published nowhere: the owner supplies `corpus.tar.gz` by hand.
[corpus.sha256](corpus.sha256) holds its SHA-256, and a replay checks the
archive against it first. The standalone JSON reports contain no paper passages.
To read it, put the supplied archive at `.papers/v3/corpus.tar.gz`, check it
and extract it into a fresh directory:

```sh
mkdir -p .papers/replay
(cd .papers/v3 && shasum -a 256 -c ../../docs/research/papers/corpus.sha256)
tar -xzf .papers/v3/corpus.tar.gz -C .papers/replay
```

The folder gather's `--offline` replay of this archive went with the command.

## Source audit

- [OpenAlex](https://help.openalex.org/access/fulltext/): metadata discovery and
  location hints. This pilot uses no paid content download endpoint.
- [EconStor](https://www.econstor.eu/handle/10419/304100): reviewed item-level
  metadata identifies the record, exact PDF and licence. Its standard terms do
  not grant unrestricted reuse to every document; item-specific CC rights matter.
- [ESRI](https://www.esri.ie/pubs/RS123.pdf): the retained source PDF explicitly
  grants CC BY 4.0 on physical page 2. This is not a blanket policy for all ESRI
  publications.
- [NBER](https://www.nber.org/nber-help-working-papers-general-information): authors
  retain copyright, and free access does not establish reuse permission. The
  seed prototype found an OpenAlex CC BY label contradicted by its NBER PDF.
- [RePEc](https://ideas.repec.org/getdata.html), [arXiv](https://info.arxiv.org/help/api/tou.html)
  and [CORE](https://core.ac.uk/terms): the earlier audit found separate access and
  per-document rights constraints. No direct adapter for these services is built.

## Remaining work

The [expanded runbook](expanded/README.md) covers the current eight-paper corpus,
larger quality sample, sentence-support gate and assistant citation cards.
Production D1 storage, scalable indexing, scheduled gathering and deployment
remain step 5. The [three-paper retrieval report](retrieval/README.md) is a
historical development checkpoint.
