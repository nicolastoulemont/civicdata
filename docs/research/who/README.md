# WHO life expectancy at birth

The first WHO slice admits only `WHO:WHOSIS_000001`. It reads annual national
WHO estimates through the public xMart API, without bulk storage or a gather.
It does not substitute equivalent World Bank observations. Sex (`FEMALE`,
`MALE`, `TOTAL`), age (`BIRTH`) and unit (`YEARS`) are required choices, including
the singleton dimensions. No sex is chosen implicitly.

## Evidence and meaning

Checked 11 November 2026 against primary public endpoints. Exact response bodies,
URLs and response dates live in `packages/server/test/fixtures/who/`. `requests.json`
records the three runtime requests. `dimensions.json` records a group-by probe of
sex, value type, annual period and the first unused dimensions. It is evidence,
not a data store. Runtime rows require all remaining dimension slots 2–9 to be null.

The [indicator directory](https://xmart-api-public.who.int/DATA_/IND_DIRECTORY)
publishes `IND_URI_API` on WHO's Azure front door and `IND_PUBLISH_TABLE` as
`DATA_/RELAY_MAY2023`. The adapter verifies both exact reviewed addresses and
uses that table on the public xMart production host. It never tries
`DATA_/WHOSIS_000001`, which answered 200 with error text, or the
[deprecated GHO API](https://www.who.int/data/gho/legacy).

The [WHO definition](https://www.who.int/data/gho/data/indicators/indicator-details/GHO/life-expectancy)
defines period life expectancy from prevailing sex/age-specific mortality rates.
This is a WHO estimate, not a forecast or a nationally endorsed statistic.
Annual observations do not imply annual releases. The older metadata page's
1990–2021 coverage is not used to bound current observations.

The live route publishes lower/upper fields and formatted labels, while its directory
says `VALUE_CONFIDENCE=false`. This flag is not used to erase published bounds.
The [current WHO life-table methods (September 2026)](https://cdn.who.int/media/docs/default-source/gho-documents/global-health-estimates/ghe2023_lifetable_methods.pdf?sfvrsn=d5132ed3_2),
section 5.2, documents 1,000 Monte Carlo draws and the 2.5th/97.5th percentiles as
95% uncertainty bounds. This is the reviewed GHE2023 method, not V-Dem HPD or
an assumed frequentist confidence level. The typed WHO qualification retains
level 0.95, method identity, method URL and the actual fetched bounds separately,
including one-sided bounds and nulls. Raw publisher labels remain visible. Every
country-year retains its row version, update time, status, comments, calculation/
provenance text and published state. Missing numbers remain qualifications, never
zeros or invented observations. Qualified transforms remain rejected.

## Country identities and coverage

`REFMART/REF_COUNTRY` maps M49 to ISO alpha-3. Only WHO Member States (`M`)
with an exact recognized app country code enter the map. Duplicate mappings
fail. Territories, aggregates and unresolved identities are excluded. The current
methods paper p.3 identifies territorial exclusions for Cyprus, Georgia, Moldova,
Russia and Serbia, non-citizen resident exclusions for Singapore, and exclusion
of Rodrigues for Mauritius. All seven are outside this first slice pending a
separate scope review, even though their ISO codes match. Observations
must say `COUNTRY`, match the selected sex, country and year, and have no other
disaggregation. Wrong rows, invalid bounds and duplicate country-years fail the
whole read. The catalog's countries and years stay **unknown**, not dictionary
coverage; fetched observations and missing records establish series availability.
The recording contains France 2022–2023, both sexes; it is not full-source coverage.

## Transport and cache

The [xMart API documentation](https://extranet.who.int/xmart4/docs/xmart_api/use_API.html)
documents `$filter`, `$count`, `$top`, `$skip` and ordered pagination. Requests
filter the indicator, national geography, selected M49 codes, sex and year bounds.
Ordered pages of at most 1,000 rows must reach a stable declared count. Reads are
bounded to one directory entry, 300 dictionary entries and 30,000 observations.
An empty premature page, changed count, duplicate, malformed JSON (including
200 error text), dependency failure or unexpected continuation fails the read.
Continuations must retain the exact public host, table, filter, order and next
offset; foreign hosts, changed queries and cycles are rejected. No private route
or authenticated endpoint is used.

The docs specify a 120,000-row JSON response cap, not a request quota. No public
request-per-minute quota was found. Our own conservative budget is ten requests
per minute with a minute cooldown after 429; this is not presented as WHO policy.
The shared Pace layer applies it to this host. Metadata and geography are memoized
for a day, successes only. `Api` reads use Cache.remember for a day, retaining the
original retrieval time; Series.widen makes recent-year coverage and charts reuse
the same answer. A failed refresh may serve the previous successful cached answer,
according to existing Cache policy.

## Terms and attribution

The directory identifies this as a primary data.who.int indicator. Its
[dataset terms](https://data.who.int/about/data/terms-and-conditions) specify
CC BY 4.0 unless otherwise indicated, with additional WHO terms, attribution,
no implied endorsement and third-party exclusions. The directory lists no
third-party source (`SOURCE_CODE=null`); this does not grant rights to unrelated
third-party material. Credit stays on charts, shares and embeds: World Health
Organization, Global Health Estimates, indicator, API URL, metadata version/update
and retrieval date. Each observation's version/update stays in its qualifications.
The [general WHO compilations terms](https://www.who.int/about/policies/publishing/data-policy/terms-and-conditions)
are more restrictive (public-health use and modification limits); do not generalize
the data.who.int licence to other WHO datasets. No emblem or endorsement is used.
No account, agreement acceptance flow or publisher contact was performed.

## Delivery limits

Normal isolated PR catalog CI is authorized with `own-catalog`. No manual catalog
build, fill, gather, credential operation or paid eval is needed or performed.
Other WHO indicators, WID and IMF remain future work under NTO-219. Existing
stored-source first fills remain separate owner-approved operations.
