# Governments checked by hand

`government-updates-west.json` and `government-updates-east.json` are copied unchanged from countries-comparison (`data/elections/`, commit `b99b578`, checked on 18 October 2026). They record the cabinets formed after PPEG's archive ends (31 October 2025), each with the government, presidency or parliament pages that establish it.

Each formation is a point observation. `Archives.ts` reads it as the start of a government that ends the archive's last one; its own end stays open until a later formation. An empty `parties` list means the composition was not established, not that the cabinet had no parties. `verifiedThrough` is null everywhere: these files do not certify a continuous cabinet history.

The scheduled build never refreshes these files. To update them, re-read the linked pages, edit the formations and `checkedAt`, and copy the files here again.
