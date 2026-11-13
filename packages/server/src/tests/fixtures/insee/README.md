# Melodi recordings

Recorded anonymously on 11 November 2026, without credentials or production writes.

- `catalog.json`: https://api.insee.fr/melodi/catalog/DD_CNA_AGREGATS
- `range.json`: https://api.insee.fr/melodi/range/DD_CNA_AGREGATS
- `page1.json`, `page2.json`: exact responses to their `paging.first` and
  `paging.next` URLs, with `maxResult=1`, `page=1` or `page=2`, national GDP
  at current prices, 2024–2025. Every dimension and date filter is in those URLs.

The fake HttpClient returns the small first-page recording for the adapter's
larger requested page size. It then follows the publisher's recorded next link.
This exercises pagination without changing the recorded rows or flags. Exclusion
and duplicate tests mutate these valid recordings only for the case they assert.

Source: Insee. Dataset last updated 31 August 2026. Open Licence 2.0,
as declared by Melodi's OpenAPI and https://www.insee.fr/fr/information/2008466.
