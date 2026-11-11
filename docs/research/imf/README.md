# IMF WEO initial slice

Reviewed 11 November 2026 against the official SDMX 2.1 API. Only
`IMF:NGDP_RPCH`, France (FRA) and Sweden (SWE), 2020–2030, is admitted.
The two CSV fixtures are complete bounded publisher responses, not a root archive.

## Identity and geography

[IMF API documentation](https://data.imf.org/en/Resource-Pages/IMF-API)
identifies the SDMX APIs. The live flow is `IMF.RES:WEO(9.0.0)`, using
`IMF.RES:DSD_WEO(9.0.0)`. Its key dimensions are COUNTRY, INDICATOR, FREQUENCY.
Schema version 9.0.0 is **not** a publication vintage.
`metadata.xml` contains selected official codelist/concept excerpts; `evidence.json`
records request URLs, time and hashes. The DSD identifies NGDP_RPCH as GDP,
constant prices, percent change; PT is percent, Q is constant prices, A is annual,
and response SCALE=0. Published numbers remain in percent with no division by
100, rounding to DECIMALS_DISPLAYED, annualization or interpolation.

The IMF country codelist explicitly names FRA France and SWE Sweden. These are
national WEO economic territories, not aggregates or a mainland-only selection.
Separate French territories in the codelist are not mapped into FRA or added to
it. This slice does not assert equivalence to another publisher's territorial
coverage. Both responses use ESA 2010 and January/December reporting years.
France has base year 2020 and chain weighting from 1980; Sweden has base year 2025
and chain weighting from 1993. All supplied country method/revision notes remain
attached. These are growth rates, not comparable constant-price GDP levels.

## Actuals and vintage

[The publisher FAQ](https://data.imf.org/Datasets/WEO/Frequently-Asked-Questions)
and the DSD's LATEST_ACTUAL_ANNUAL_DATA definition say years following that cutoff
are staff estimates. Even designated actuals can be revised. Zero means the whole
series is estimated. Neither the wall clock nor common forecast shading in the
report defines the status of a country-year.

Both reviewed responses designate 2025 as latest actual. Each qualification carries
that cutoff, publication timestamp `2026-10-13T02:00:00Z`, and either `Actual` or
`EstimateProjection`. We do not invent a split between estimates and projections.
The entire raw nonempty metadata row is retained in publisher notes, including
update, country update, citation, licence, base year and methodology. Empty numbers
are missing, not zero. Original numeric text is preserved by the response hash and
recorded fixture; numeric values retain all supplied precision. No uncertainty
interval is implied. Qualified transforms are rejected through the shared policy.
Resolver/tool summaries and the common chart qualification list retain status and
vintage, including restored/shared/embedded charts; our framing has eight locales.

## Snapshot and operation

No immutable official release URL was verified. The `latest` SDMX route is mutable;
HEAD returned 404. This implementation pins a **reviewed snapshot**, identified by
the publication timestamp plus both exact bounded-response SHA-256 hashes. It does
not call that route immutable. A value-only, note-only or status-only revision
fails the pin instead of silently adopting it. Reviewing a new snapshot requires
updating the evidence, expected hashes and chronological release order together.
Order currently follows publication time. Same-publication revisions need a new,
explicitly reviewed monotone order before adoption; they cannot overwrite this pin.

The Node-only `pnpm --filter @openfacts/server imf` command uses shared Gather,
Inputs.collect, D1 and signed conditional R2 storage. It assembles both countries
as one complete series before staging, verifies exact input bytes again immediately
before conditional activation, and retains the previous active release on failure.
Selected normalized fragments and successful-input ledger entries survive sibling,
assembly and activation failures. Verification intentionally reads the two bounded
responses again; it is not an archive re-download. Publisher changes after the
last verification remain possible: the remote service offers no transaction across
requests. Hash identity makes the selected snapshot explicit.

Workers expose discovery and StoredOnly reads without enrolling the Node ingester.
Catalog country/year coverage is unknown until stored reads establish it. Missing
first fill returns NotStored and never downloads from IMF on a chart request.

A later owner-approved fill needs explicit `IMF_D1_ID`, `IMF_R2_BUCKET`,
`CLOUDFLARE_ACCOUNT_ID`, D1 `CLOUDFLARE_API_TOKEN` and existing R2 credentials
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. No secrets should be logged or created.
The reviewed mutable responses may have changed by then; a mismatch needs evidence
review, not a hash bypass. No production/preview fill, gather or manual catalog
build ran during delivery. The PR needs `own-catalog` for isolated CI resources.

## Terms and limits

The selected [IMF terms](https://www.imf.org/en/about/copyright-and-terms), special
terms for statistical data, explicitly include WEO. Reproduced data must be accurate
and attributed, transformations disclosed, and reuse terms communicated to users.
Third-party rights remain with their holders. The general terms restrict automated
bulk downloads and model training; this slice requests only two bounded series,
not a whole archive, and does not train a model. The owner confirmed noncommercial
open-source use. No account, agreement, form or permission request was submitted.
Commercial reuse requires separate review under IMF's terms. Dataset attribution
links both WEO and the terms; no other source's licence is applied to IMF.

Wider IMF coverage, other vintages, other indicators/countries and approved first
fills remain outside this slice. NTO-219 stays In Progress pending review and delivery.
