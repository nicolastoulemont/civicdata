# Records checked by hand

`government-updates-west.json` and `government-updates-east.json` are copied unchanged from countries-comparison (`data/elections/`, commit `b99b578`, checked on 18 October 2026). They record the cabinets formed after PPEG's archive ends (31 October 2025), each with the government, presidency or parliament pages that establish it.

Each formation is a point observation. `Archives.ts` reads it as the start of a government that ends the archive's last one; its own end stays open until a later formation. An empty `parties` list means the composition was not established, not that the cabinet had no parties. `verifiedThrough` is null everywhere: these files do not certify a continuous cabinet history.

The scheduled build never refreshes these files. To update them, re-read the linked pages, edit the formations and `checkedAt`, and copy the files here again.

`elections.json` is countries-comparison's `data/elections/updates.json` (commit `843d58f`), copied unchanged: the national elections of 2026, one entry per ballot, each linking the electoral authority's result table. `Archives.ts` reads one election per country, kind and `election_date`, with its last round when a runoff followed. Its scores are kept but not read.

`events.json` holds the 24 events countries-comparison marks on its charts (`src/features/over-time/context/catalog.json`, commit `e9b053f`), each with its classification from `research.json` beside it. `reforms.json` holds its 20 pension reforms (`src/domain/reforms.json`, same commit). Both are ported, not copied: Eurostat geo codes became ISO3 (`EL` is `GRC`), each source label split into publisher and title, and each event dropped its `relevance` note, which describes how an event may move a chart. One summary was reworded for the same reason: the Irish GDP level shift now says what the Central Statistics Office recorded.

countries-comparison lists the EU members an event concerns. These scopes are wider here, each on the source added to the event:

- COVID-19 emergency: every country. The WHO statement it already cites ends a public health emergency of international concern.
- Maastricht Treaty, signature and entry into force: adds the United Kingdom, a party to the Treaty on European Union as EUR-Lex publishes it (OJ C 191, 29 July 1992).
- Russia's full-scale invasion of Ukraine: adds Ukraine and Russia, as UN General Assembly resolution ES-11/1 (2 March 2022) names them.

The other events keep their countries: no source they cite, or that we could fetch on 9 November 2026, puts the oil shocks or the 2007 to 2009 financial crisis beyond Europe.

`Politics.ts` decodes both files with the domain's `Politics` schema, which requires at least one https source per record. To update them, edit the records here and their sources together.
