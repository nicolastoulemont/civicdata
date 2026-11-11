# V-Dem electoral democracy, V16

This slice admits only `V-Dem:v2x_polyarchy`, France (V-Dem country_id 76,
FRA) and Sweden (5, SWE), 1991–2025. The pinned data contains 70 numeric
country-years, each with both bounds. Other indices, other units and earlier
years remain unlisted or excluded pending identity review. This is not a full
V-Dem integration. Discovery bounds describe this actual selection, not a code
dictionary. `find_years` verifies availability against the selected stored data;
no data is available before an approved fill.

## Publisher evidence

Verified on 2026-11-11:

- [Dataset and licence guidance](https://v-dem.net/data/the-v-dem-dataset/)
  identifies V16, published March 2026, recommends the official
  [R package](https://github.com/vdeminstitute/vdemdata) and requires attribution
  and share-alike under CC BY-SA 4.0, including commercial reuse.
- [V16 codebook](https://v-dem.net/documents/70/codebook_v16.pdf), §2.1.1,
  defines electoral democracy through suffrage, clean elections, elected
  officials, association and expression. This is an expert-informed aggregate
  index on an interval scale from 0 to 1, not a count or a percentage. The
  publisher assigns country-year values using day-weighted means. We preserve
  their published values, without performing aggregation ourselves.
- Codebook §1.4.3 defines the `_codelow` and `_codehigh` suffixes; §1.5.1 gives
  68% highest posterior density (HPD) intervals for these high-level indices,
  using posterior component samples. They are not 95% frequentist confidence intervals, nor
  symmetric error bars computed from a standard deviation. The data contract
  keeps the raw field names, method, level and codebook URL.
- Codebook §2.1.1 notes the preliminary aggregation formula in releases 1–5.
  The [FAQ](https://v-dem.net/about/faq/) and dataset page warn against comparing
  absolute scores across releases, because revisions, coders, coverage and model
  inputs change. All selected years and bounds come from one V16 asset.
- [V16 country units](https://v-dem.net/documents/72/countryunit_v16.pdf) and
  codebook §§1.6–1.7 explain that source units need not equal today's countries.
  We admit two explicitly reviewed identities in a recent period. France is the publisher’s European possessions only, excluding overseas
  departments and territories (§5.5.6); this narrower scope is retained in
  visible country-year notes and the definition. Sweden excludes Saint
  Barthélemy (§5.3.5). The post-1990 window avoids earlier regime and territorial
  changes without claiming all countries have been reviewed. No predecessor
  state, colony, aggregate or subnational row is mapped to a modern country.
  `coverage.json` lists every other source unit explicitly as excluded from this
  first slice, including DDR, South Yemen, Somaliland, Palestine's separate
  units and historical German/Italian states. No claim is made that excluded
  modern countries are intrinsically unsupported by V-Dem.

R NA becomes JSON null, never zero. A missing estimate must have both bounds
missing. A numeric estimate must have two finite, ordered bounds on 0–1 enclosing
it. Partial, malformed or out-of-scale intervals fail the asset. Missing records
retain their country-year qualification. No interpolation, rescaling, interval
arithmetic or cross-release splicing occurs. Qualified transforms fail with
`TransformNotApplicable`. The visible chart evidence lists each estimate and
interval in the chart, including restored, shared and embedded compositions.
The full publisher method note and release identity survive resolver/tool output.

## Immutable input and reproduction

The official V16 tag resolves to commit
`f4dd26922e658442524dfd954bf14f7ebe622d5d`. Ingestion uses that commit URL,
never `latest` or a mutable tag:

| File under `data/` | SHA-256                                                          |
| ------------------ | ---------------------------------------------------------------- |
| vdem.RData         | 39b412d39a061c18f20c98e4ad4d6355b05a0441df31be4ee9aec420dc3d95ea |
| codebook.RData     | 2840d879cb9071b1f742f5f18c5373518a586ac90454b58dbf5f4309077f0700 |

The authorized bounded verification downloaded these two files only from that
release, plus its public reference PDF. The root RData is not committed.
`records.json` is the unrounded seven-column subset for 1991, 2024 and 2025 for
the two admitted countries. `coverage.json` records counts and excluded units.
Regenerate from the pinned local archive:

```sh
python3 -m venv /tmp/vdem-python
/tmp/vdem-python/bin/pip install pyreadr==0.5.9 pandas==3.1.1
/tmp/vdem-python/bin/python packages/server/scripts/vdem-extract.py /path/to/vdem.RData /tmp/vdem-rows.jsonl
```

The extractor verifies the checksum before reading RData. It emits original
selected column values for every source row; the typed adapter applies the
reviewed identity/year selection. To reproduce `records.json`, keep FRA/SWE
rows for 1991, 2024 and 2025; for coverage, keep years 1991–2025 and count numeric
estimates. JSON null represents R NA. No test needs the root archive or a network.

## Operational first fill

No manual production/preview fill, gather or catalog build ran. The ordinary
`own-catalog` PR CI build is authorized. Deployment alone does not fill series.
After the owner approves an explained target and operation, install the Python
requirements above, then run:

```sh
export VDEM_PYTHON=/tmp/vdem-python/bin/python
# Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, VDEM_D1_ID, VDEM_R2_BUCKET,
# R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY
# to the approved stage's existing catalog database and series bucket.
pnpm --filter @openfacts/server vdem
```

The command requires Node 24 and POSIX `sort`. It uses the shared operational
D1/R2 transport, Gather/Store ledger and sorted-series helper. The Cloudflare API
token accesses D1; the R2 S3 access key and secret access the approved bucket.
Signed S3 writes preserve object hash metadata and send atomic
[`If-None-Match: *`](https://developers.cloudflare.com/r2/api/s3/conditional-operations/)
for immutable staging. A conflicting object is never overwritten; an identical
retry can reuse it. No credential is created by this command. Only the original
pinned RData is downloaded, checked, parsed outside Workers, sorted on disk and
assembled into one complete series. Extraction currently loads the RData in
Python, so allow several GB of RAM and temporary disk; the 34 MB compressed
asset expands to 28,092 rows × 4,618 columns. Errors propagate as typed source
failures. The selected row count must be exactly 70; duplicate places fail.

`Bulk.release` declares exact membership: one country-year asset, one index,
no dimensions. Integer order 16 follows the publisher's numbered release
chronology, not lexical version ordering. Updating the pinned release requires
reviewing evidence, country selection, checksums and order together. Shared
immutable staging, complete membership validation and conditional activation
prevent half-releases and stale rollback. Failure retains the previous release;
completed assets resume without download. Resolver reader pinning keeps all
reads in an operation on the same release. Chart misses return typed `NotStored`
and never download or parse an archive. Workers have no RData transport.

## Attribution

Credit the V-Dem Project and Coppedge et al. (2026), _V-Dem Country-Year Dataset
v16_, [doi:10.23696/vdemds26](https://doi.org/10.23696/vdemds26), following the
publisher's full author citation on the dataset page. Also cite _V-Dem Codebook
v16_ and Teorell et al. (2019), “Measuring Polyarchy Across the Globe, 1900–2017”,
_Studies in Comparative International Development_ 54, 71–95,
[doi:10.1007/s12116-018-9268-z](https://doi.org/10.1007/s12116-018-9268-z), as
requested by the index entry. Stored chart credit retains these references,
CC BY-SA 4.0, the source URL, immutable version and retrieval time. The only
changes are country/year/column selection and format. Redistributed selected
data and adaptations retain CC BY-SA 4.0; no endorsement is implied. No form,
account, publisher contact or agreement acceptance was used.

INSEE, ILOSTAT and FAOSTAT retain their existing slices. WHO, WID and IMF remain
outstanding under NTO-219; this does not complete the seven-source program.
