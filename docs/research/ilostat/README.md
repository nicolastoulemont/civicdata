# ILOSTAT integration decision

Status: the approved first-table implementation is described below. The evidence
and blocker analysis record the original review baseline. No production or
preview fill, manual catalog build, gather, eval or account operation ran.

## Verified access and bounds

Read-only requests on 11 November 2026 used the official
[API specification](https://rplumber.ilo.org/openapi.json),
[bulk guidance](https://ilostat.ilo.org/data/bulk/) and
[rights and permissions](https://www.ilo.org/rights-and-permissions).
The API returned the English TOC at
`https://rplumber.ilo.org/metadata/toc/indicator?format=.csv&lang=en`:
1,964 entries, 1,204 annual. The TOC supplies update timestamps and row counts,
not compressed sizes. Counts describe records, not unique country-years.
The annual entries advertise 197,196,957 records; all frequencies together
advertise 401,256,337. Annual frequency alone does not establish national,
full-year coverage.

`audit.json` records the request time, URLs, measured sizes, complete decoded
archive hashes and row counts. Only three small archive probes ran:

| Archive               | Compressed bytes | Decoded bytes |   Rows | Role                                            |
| --------------------- | ---------------: | ------------: | -----: | ----------------------------------------------- |
| SDG_B552_NOC_RT_A     |            5,147 |        38,151 |    628 | Proposed first fill, after qualifier support    |
| SDG_0552_NOC_RT_A     |           13,838 |       111,762 |  1,838 | Definition comparison, not a stitched extension |
| SDG_0111_SEX_AGE_RT_A |          250,398 |     3,512,409 | 42,030 | Demographic and quality audit only              |

Total compressed archive traffic was 269,383 bytes. This is not an enrollment of
all annual tables. None of the archive probes is a production fill. The two management
files are recorded in full. The working-poverty recording retains all Mexican, Turkish and X01 aggregate
rows, including every source, sex, age and year present for those areas.
The X01 dictionary labels it World, which must be excluded from national charts.
CSV values and missing cells were preserved; CSV quoting and line endings were
normalized when recording. Hashes in the manifest refer to the complete decoded
upstream bytes before that normalization and selection.

The selected TOC rows are in `toc.csv`. Dictionary recordings retain all status
codes and only the other codes used in the recorded rows. They came from
`https://rplumber.ilo.org/metadata/dic?var=<name>&format=.csv&lang=en`.
The API uses a `var` query parameter, not `/metadata/dic/<name>`.
No documented numeric quota was found in the guidance or API specification read.
That does not mean requests are unlimited. Retain conservative pacing, handle
429, and do not download the full advertised source.

## Concrete contract blockers

The app's `Observation` in `packages/domain/src/ResolvedView.ts` requires a finite
value and admits only Provisional, Estimated and Break. The official status
codelist instead includes Adjusted (A), Break in series (B), Model-based
extrapolation (M), Unreliable (U), Real value (R) and Imputation (I).
These are not synonyms. In particular A must never become an unflagged normal
value, and M cannot automatically become an ordinary historical estimate.

The smaller management archive contains 12 U records and 45 B records; two
records have no numeric value. The older-definition archive has 68 U records,
139 B records and nine missing values. The working-poverty archive contains
22,853 A, 1,584 R and 1,025 I records. Even this previously tested sample cannot
be read correctly by mapping its statuses to the three existing flags.

Management records also carry `note_indicator` and `note_source` codes. The
recorded dictionaries include employment-definition changes, methodology breaks,
an explicit statistical-series reliability warning and `S3:8`, a First quarter
reference period. A table's four-digit time label is insufficient to present its
values as full-year measurements. A missing value's status and notes cannot be
preserved in the current numeric-only observation schema.

Dropping notes, putting them in a dimension, or attaching one entry-wide note
would change their meaning. Notes qualify particular country-years and can
change within a series. Store hashes currently include only country, year, value
and flags, so merely adding a decoded field would also discard note-only updates.
The current stored-answer and resolved-chart schemas have no channel for these
publisher qualifiers, including qualifiers on missing observations.

`source` is part of the observation key, not just a citation. Its dictionary
also identifies its reference area. `BA:15715` and `BB:6361` are different sources,
not two interchangeable rows for Afghanistan. Sex and classification columns in
other tables are also series keys. Choosing the first row or collapsing these
keys would silently stitch surveys or populations. Source codes contain colons,
which the current dimension Code grammar excludes; they need an explicit,
reversible source-local encoding, not a global change to deployed keys.

## Narrow next implementation

Implement one explicit source slice with `SDG_B552_NOC_RT_A` only. It measures the
female share of senior and middle management under the 19th ICLS employment
framework, in percent with multiplier zero. The older-definition table remains a
separate indicator if added later. Neither is a total-management series. The
recorded official indicator descriptions specify the ISCO management categories
and warn that figures can differ from national and Global SDG database figures.
No sex or age choice is implied by these NOC tables. Do not invent demographic
dimensions for them. Working poverty stays outside the first fill.

Before wiring the adapter, add a typed publisher-qualifier channel that retains
ILOSTAT status and the three note categories by country and year, including
missing values. Carry it through stored-series decoding, value hashes, resolver
output, shares and embeds. Show Unreliable explicitly beside affected values and
show decoded methodological/reference-period notes with their years. Retain raw
codes and labels so future unknown codes fail closed rather than disappear.
Keep the existing eight-locale UI contract. Decide the treatment of annual rows
whose notes name a quarter explicitly before admitting those rows. This proposal
makes no decision to relabel or discard them.

Discovery should list only definition-reviewed annual tables whose national
coverage can be established, with source/demographic choices and labels. Do not
claim that the 1,204 annual TOC entries are already country-chartable. Discovery
coverage must remain separate from stored availability. A stored-only miss must
return typed NotStored without calling the archive or an observation endpoint.

The download unit is one selected indicator-frequency gzip archive. Use its TOC
update version and check it again after download; discard a moving snapshot.
Use the shared asset ledger for unchanged versions, failures, backoff and retry.
An unchanged successful asset must not be downloaded after another fails.
The TOC dates are documented in Europe/Paris time; do not parse them as US dates
or compare their strings as chronological release orders.

The upstream ordering is not the Store contract's sorted series-code ordering.
Use a small Node entry point that streams gzip CSV into a disk sort, groups
complete source/demographic series, and feeds the existing Gather/Store rules.
It must also provide the actual database and bucket transport; a sorter alone
is not an operational first-fill path. Do not buffer an archive in a Worker or
add a generic ingestion framework. If coherent release activation is chosen,
assemble the exact membership and chronological release order before staging.
No coherent release should be declared from guessed membership or TOC string
ordering. Existing shared machinery needs no change merely to add this adapter.

The TOC can change or remove tables; normal catalog generations handle discovery
removal. Observation deletion is a separate decision: Store holds back empty or
lossy replacements, and coherent releases reject omitted members. No documented
publisher deletion policy or immutable release guarantee was established by this
audit. Do not interpret TOC disappearance as permission to erase stored values.

Acceptance remains the requested adapter, catalog, gather/resume and stored-read
seam tests, resolver attribution and all-source routing. The present evidence
records that work's inputs, not passing implementation tests. Parent review must
resolve this qualifier proposal before claiming a usable ILOSTAT integration.

## Terms and attribution

ILO's current rights page licenses databases, datasets and accompanying metadata
published from 3 May 2023 under CC BY 4.0. It excludes restricted microdata and
warns that older products and third-party components can have different terms.
These recordings are public aggregate tables and referential metadata, not
microdata. No selected-table exception was found. Credit the International Labour
Organization (ILO), ILOSTAT, indicator and dataset, source version, download URL
and retrieval date; link CC BY 4.0 and state selection/format changes. Do not use
the ILO emblem or imply endorsement. CC BY 4.0 also requires indicating changes.

Source: International Labour Organization, ILOSTAT. CC BY 4.0. Downloaded
11 November 2026. Recordings select tables, countries and dictionary rows as
specified above and normalize CSV serialization. No charted values are computed,
aggregated, interpolated or entered by hand. No external agreement was accepted.
Any manual production catalog build, fill or gather needs the owner's explanation
and approval; this proposal authorizes none.

## Implemented first slice

The approved follow-up implements `ILOSTAT:SDG_B552_NOC_RT_A` only. The blocker
analysis above records the pre-implementation contract. Publisher qualifications
now travel separately from finite numeric observations, keyed by source, complete
series choice, country and year. The collection retains raw status and note codes,
decoded labels, survey labels, missing-value state and exclusion reasons. Unknown
status, note and survey codes fail closed. The reviewed dictionaries are checked
in with the codecs; expanding this allowlist requires another definition review.
No forecast or uncertainty contract is claimed.

The recorded 628 rows have these results under the existing country universe:

- 12 rows are outside supported country codes: COK (2), KOS (7), NIU (1), TKL (1),
  WLF (1). No country-code equivalence is guessed. There are no regional/world
  aggregates in this selected archive; X01 remains outside national discovery.
- The remaining 616 country-years retain their qualifications, including 10 U,
  42 B and both missing numbers. The original archive has 12 U and 45 B overall.
- 10 supported country-years have quarter, semester or month reference notes and
  are excluded from plotted values. Afghanistan 2021 overlaps this count with a
  missing number. Neither its U status nor its First quarter note disappears.
- There are 605 finite plotted observations. The noncalendar-year and USA
  eleven-month annual-average notes remain attached to their observations.
  None of the selected archive's notes confirms partial geography. Recognized
  S4 geography exclusions are nevertheless explicit if encountered.

Discovery lists one reviewed table, with an explicit source/survey dimension,
reviewed survey labels and supported countries. Its year bounds remain unknown
until stored coverage is queried. It does not enroll 1,204 annual TOC entries.
Survey codes are encoded as `s` followed by hexadecimal UTF-8 bytes, so
`BA:15715` is `s42413a3135373135`; decoding each byte pair restores the raw code.
Global dimension/key grammars, deployed ids and `series/v2` paths are unchanged.

Qualified transforms are rejected with `TransformNotApplicable`, including a
qualified divisor. Original values retain country-year warnings in resolver and
chart-tool output, restored charts, shared/embedded charts and the chart's
visible warning list. Existing unqualified stored payloads still decode and keep
their previous value hashes. Notes alone change a qualified series' hash.

### Manual first fill

`pnpm --filter @repo/server run ilostat` is a Node-only manual operation.
It requires `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ILOSTAT_D1_ID` and
`ILOSTAT_R2_BUCKET`, naming the existing stage database and series bucket, plus
`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for that bucket. The Cloudflare API
token accesses D1; the R2 credentials sign S3 object operations. Obtain owner approval for the exact
stage and operation before running it. No such operation ran during development.

The entry point uses the real D1 HTTP client and R2 S3 API, streams the
selected gzip through CSV decoding to a temporary directory, uses the machine's
`sort` with `LC_ALL=C`, groups one complete survey at a time and calls shared
Gather/Store rules. The TOC version is checked again before offering any series;
a moving snapshot fails the asset. Day/month/Paris timestamps remain opaque
versions and never become US dates or lexical chronological release orders.
Temporary files are removed on exit. Unknown columns/codes, duplicate keys,
malformed CSV and moving snapshots fail closed. Traffic is paced at 10 requests
per minute with cooldown on 429 and bounded transient retries. This budget is a
conservative operational choice, not an asserted publisher quota.

Only a Node adapter supplied with the disk reader enrolls the selected asset.
Worker catalog and chart readers expose metadata and StoredOnly reads without
an inoperative scheduled archive mirror. An absent stored series returns typed
NotStored and makes no observation/archive request. The shared ledger skips
successful unchanged assets and owns failure/backoff/resume. No new framework or
cross-source counterpart is introduced. The other six source integrations remain
outside this PR, and NTO-219 stays open.
