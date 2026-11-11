# WID national income shares

Reviewed on 2026-11-11 for NTO-219. Only `WID:sptinc992j`, France
(`FR` → `FRA`) and Sweden (`SE` → `SWE`), 1991–2024, are admitted.
The two complete series select `p0p50` (bottom 50%) and `p90p100` (top 10%).
Age `992` means individuals over age 20; population `j` splits resources equally
within couples. Unit `share` is a fraction, not a percentage. Values are copied
without scaling, interpolation, aggregation, publisher pairing or uncertainty.
Pre-tax income counts pensions on a distribution basis, before other taxes and
transfers. It is not fiscal income or disposable income.

## Official evidence

- [Bulk publication contract](https://wid.world/bulk_download/README.md):
  semicolon CSV, country-file and metadata layouts, native percentile meanings.
  This older README lists seven data columns; current files add `data_quality`.
- [Code dictionary](https://wid.world/codes-dictionary/), §§2.1.1, 2.2 and 4.1.1:
  `s` is a fraction between zero and one, `ptinc` is pre-tax national income.
- [Country identities](https://wid.world/bulk_download/WID_countries.csv):
  FR = France; SE = Sweden. These are explicit reviewed mappings, not an ISO join.
  Other countries, subnational units, historical units, aggregates and unresolved
  identities are excluded. No geographic continuity is inferred.
- [France metadata](https://wid.world/bulk_download/WID_metadata_FR.csv) and
  [Sweden metadata](https://wid.world/bulk_download/WID_metadata_SE.csv): select
  exactly `sptinc992j`, `age=992`, `pop=j`. The committed metadata extracts retain
  all publisher fields, including source, method and average quality.
- [France data](https://wid.world/bulk_download/WID_data_FR.csv) and
  [Sweden data](https://wid.world/bulk_download/WID_data_SE.csv): committed CSVs
  contain only those two percentiles in the reviewed years, 68 original rows each.
- [Quality definitions](https://wid.world/data-quality/): annual distributed-income
  grades 0–5 mean regional imputation, carry forward/backward, interpolation,
  one source type, tax and survey data, and tax and survey microdata respectively.
  Grades describe publisher construction, not confidence intervals. Blank quality
  is unknown, never inferred from `avg_quality`.

France's notes describe tax/survey/national-accounts integration through 2016 and
later extensions using tax tabulations and percentile ratios. Sweden's notes
specify survey years, tax corrections through 2013 and interpolation between
available survey years. The runtime retains the full source and method strings,
including WID link markup, as plain text qualifications, together with each raw
yearly quality code and its decoded label. No causal finding is added.

[Public download page](https://wid.world/data/) supplies the data without login.
The owner explicitly confirmed noncommercial, open-source use and authorized WID
on that basis. This integration credits World Inequality Database (WID.world)
and preserves source/method citations. It does not claim a commercial licence,
or apply a report's Creative Commons licence to the database. No agreement was
accepted, contact made, account created or form submitted. Dataset reuse terms
are not encoded in CSV/HTTP metadata; the noncommercial scope is a delivery
constraint. The guessed `/terms-of-use/` and `/terms-and-conditions/` routes were
404 and are not used as evidence.

## Selected extracts

To reproduce, download the four official CSVs transiently. With Python's standard
`csv.DictReader(delimiter=';')`, retain `variable == 'sptinc992j'` in metadata;
in data also retain `percentile in ('p0p50', 'p90p100')` and
`1991 <= int(year) <= 2024`. Write with `csv.DictWriter(delimiter=';')`, preserving
headers and all fields. Do not commit the complete country archives. `evidence.json` records full-download SHA-256 hashes and HTTP headers rechecked
after extraction; `verifiedAt` is the header verification time, not a claimed
atomic publisher release or download timestamp. Extracts
preserve numeric text, including trailing zeros. Current selected data contain
136 numeric country-years across the two series, no missing numbers.

## Operational command

Only after owner approval for a named target:

```
pnpm --filter @openfacts/server wid
```

Required variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (D1),
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WID_D1_ID`, `WID_R2_BUCKET`.
Use an existing catalog containing the local WID entry. Normal isolated PR CI
builds that catalog with `own-catalog`. No manual production or preview catalog
build, fill or gather was performed during implementation. No paid eval ran.
The command uses the shared signed S3 R2 transport with conditional immutable
writes. It does not print credentials. IMF and wider coverage remain separate.

Four HEAD requests select strong ETags and valid Last-Modified timestamps.
Each bounded GET must match its selected headers; it computes a SHA-256 over
all response bytes while retaining only the selected normalized fragment.
Data is capped at 128 MB per input; metadata at 8 MB; each GET has a five-minute
timeout. The two data inputs and two metadata inputs persist independently in
D1 `source_input`, using the shared asset ledger/backoff in `/inputs/v1`.
Successful inputs survive a sibling failure, process restart or assembly failure.
No root archive is kept by default. Ledger completion follows persistence;
a retry can recover a persisted fragment if completion itself failed.

Assembly requires exact input membership, two countries and 34 distinct annual
places per percentile. Invalid identity, dimensions, fractions, quality codes,
duplicates, missing rows or metadata fail the candidate. Explicit blank/NA
numbers retain missing qualifications, without producing zero. Absent rows are
not filled. A newly absent year requires reviewed scope/missingness handling
before a replacement can activate.

Release version is the ordered four-file URL/ETag/Last-Modified manifest; release
order is its greatest HTTP Last-Modified millisecond. Equal/older orders do not
replace active releases. An ETag-only correction without a newer Last-Modified
requires publisher chronology review rather than an invented release order.
There is no common WID release identifier or immutable file pin in this route.
All selected headers are rechecked after staging and immediately before shared
conditional activation. A mutation during verification is still possible: these
are individually checked mutable snapshots, not an atomic publisher vintage.
The previous active release remains readable on download, assembly, staging,
verification or activation failure.

Each stored series and resolver/tool result carries four typed input records:
URL, retrieval time, header version, ETag, Last-Modified and SHA-256. Store hashes
include this evidence only when present; existing source hashes and cache
serialization stay stable. Common chart attribution, share/embed rendering and
About links retain every input, rather than assigning France's retrieval to
Sweden. Qualified transforms remain rejected. Catalog coverage stays unknown;
only stored observations establish country/year availability.
