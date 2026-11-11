# FAOSTAT first slice

`FAOSTAT:AE` admits only ASTI expenditure measure `8006`: agricultural research
and development expenditure as a share of agricultural value added, in percent.
The unit is `%`, with no multiplier, currency conversion or aggregation by this
app. Both numerator and denominator use the publisher's standard local currency.
This is research intensity, not total agricultural expenditure.

Every series requires `measure=8006`, `cost=300` (Total), and `institution=200`
(Government, Higher Education and Private Non-profit). The archive and dictionaries
use commas versus semicolons in institution/indicator labels; the adapter exposes
the CSV spelling. Private for-profit spending is excluded by the publisher.
ASTI records actual expenditure, not budgets. If the financial year differs from
the calendar year, ASTI assigns it to the calendar year covering most of that
financial year. These are annual reporting periods, not guaranteed January to
December cash flows. No subannual periods enter the series.

The four other measures are deliberately unlisted: `8000` current standard local
currency, `8001` constant 2015 standard local currency, `8002` constant 2015 US
dollars and `8003` constant 2015 PPP US dollars. Their `million SLC` and `million
USD` labels alone do not establish interchangeable currencies or price bases.
Neither the app nor its model derives any of these measures from another.

## Official evidence

Read-only retrieval on 11 November 2026:

- [FAO bulk manifest](https://bulks-faostat.fao.org/production/datasets_E.json):
  69 domains. Only the AE record is committed as `manifest.json`, including its
  definition, timestamp, path and 7,789 row count. It describes national R&D
  expenditure and the institutional scope. Other domains are not enrolled.
- [Complete AE ZIP](<https://bulks-faostat.fao.org/production/ASTI_Expenditures_E_All_Data_(Normalized).zip>):
  committed as `AE.zip` (78,271 bytes), containing the observations, area,
  indicator, institution, cost-category and flag dictionaries. The observation
  CSV is 1,736,762 bytes. `record.json` is an unchanged Argentina 2010 row.
- [ASTI methodology](https://www.asti.cgiar.org/methodology): actual spending,
  institution coverage and financial-year assignment. Its older currency base
  examples do not override the 2015 bases in the current FAO archive.
- [FAO collection description](https://www.fao.org/statistics/data-collection/general/en):
  annual questionnaire and national agricultural R&D aggregates.
- [UN M49 country/area table](https://unstats.un.org/unsd/methodology/m49/overview/):
  the FAO area dictionary's M49 codes were joined to the UN country/area rows'
  ISO alpha-3 codes. `packages/server/src/faostat.json` records every AE area,
  its original code, label and M49 code, and an explicit country or null exclusion.
  The adapter also requires the app's supported Country. No numeric code range
  implies national status. FAO China (M49 159) and China, mainland (156) are both
  excluded: neither is silently equated with the app's China. Channel Islands
  has no UN alpha-3 mapping and is excluded. Regional, world and economic groups
  have null mappings. Unknown areas or changed code/label pairs fail ingestion.

The recorded selected series has 1,305 numeric observations from 123 supported
countries over 2004–2023, with gaps. Fifteen of 1,320 measure-8006 rows are excluded
by the explicit geography mapping. There are no missing numbers or nonempty
notes in this version. The reader nevertheless retains missing numbers and
notes, with tests using explicit deltas to the official row.

Selected flags: 159 A (Official figure), 1 B (Time series break), 114 I (Value
imputed by a receiving agency), 1,031 X (Figure from external organization).
The archive also defines E (Estimated value). Only B and E map to existing
Break and Estimated flags. A, I and X retain their raw distinctions. Unknown
flags retain their raw code with an unrecognized label; they are never relabelled
as estimates or reliability warnings. FAO qualifications have no survey field.
Notes, flags and missingness survive hashes, storage, resolver/tools and visible
chart warnings, including shares and embeds. Qualified transforms are rejected
by the existing contract. Existing ILO qualification payloads and hashes remain.

## Terms and credit

The [FAO database terms](https://www.fao.org/contact-us/terms/db-terms-of-use/en)
include FAOSTAT under CC BY 4.0 with additional terms and third-party exceptions.
No different licence or third-party reuse exception is stated in the selected
manifest record or archive dictionaries. External-organization flags remain
visible; they do not assert that FAO originally collected those values. FAO's
non-endorsement and prohibition on promotional use still apply. This integration
adds no account, publisher contact or terms-acceptance operation.

Stored credit names FAO, FAOSTAT, ASTI expenditures, the update year and version,
licence and terms URL, source archive URL and retrieval time. It identifies the
national/annual selection and format change, with no aggregation or conversion.
Do not represent the data as live before an approved fill.

## Local operation

Discovery reads only the public manifest and local reviewed dimensions and labels.
The geography dictionary validates codes, but does not establish measure coverage:
it includes Zimbabwe, which has no measure-8006 rows in the recorded archive.
Search leaves country coverage and year bounds unknown; `find_years` reports
availability for the selected stored series. Describe
returns every required dimension, including singletons. Chart reads are
StoredOnly, with typed NotStored and no archive or observation request on a miss.
The Worker has no archive transport and no FAO gather enrollment.

After a separately explained and approved operation, an operator can run
`pnpm --filter @openfacts/server faostat` with `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `FAOSTAT_D1_ID`, `FAOSTAT_R2_BUCKET`, `R2_ACCESS_KEY_ID`
and `R2_SECRET_ACCESS_KEY`. The API token accesses D1; the R2 credentials sign
S3 object operations on the approved bucket. This is a real
D1/R2 transport through shared Gather/Store, not an alternative ledger. It
requires Node, `unzip` and POSIX `sort`. It downloads only the AE ZIP to a
scoped temporary folder, extracts only the normalized CSV, parses and sorts rows
on disk, and assembles the complete selected series. It verifies the manifest
row count and rechecks the source version before offering any series. ZIP,
HTTP-body, CSV and moving-version errors fail the asset through typed errors.
Multiline future CSV notes fail closed rather than publish a partial record.
The shared ledger owns unchanged-version skips, failure/backoff and retries.
The one admitted measure needs no multi-indicator coherent release.

The committed fixtures support offline tests with fake HttpClient and D1/R2
layers. No production or preview fill, manual catalog build or paid eval ran.
The ordinary own-catalog PR preview catalog build is authorized. Remaining AE
measures and all other FAOSTAT domains require separate definition review.
