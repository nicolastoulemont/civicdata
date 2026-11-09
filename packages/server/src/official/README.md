# Records checked by hand

`government-updates-west.json` and `government-updates-east.json` are copied unchanged from countries-comparison (`data/elections/`, commit `b99b578`, checked on 18 October 2026). They record the cabinets formed after PPEG's archive ends (31 October 2025), each with the government, presidency or parliament pages that establish it.

Each formation is a point observation. `Archives.ts` reads it as the start of a government that ends the archive's last one; its own end stays open until a later formation. An empty `parties` list means the composition was not established, not that the cabinet had no parties. `verifiedThrough` is null everywhere: these files do not certify a continuous cabinet history.

The scheduled build never refreshes these files. To update them, re-read the linked pages, edit the formations and `checkedAt`, and copy the files here again.

`elections.json` is countries-comparison's `data/elections/updates.json` (commit `843d58f`), copied unchanged: the national elections of 2026, one entry per ballot, each linking the electoral authority's result table. `Archives.ts` reads one election per country, kind and `election_date`, with its last round when a runoff followed. Its scores are kept but not read.
