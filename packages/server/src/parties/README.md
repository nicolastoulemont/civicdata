# Party colours

`colors.json` lists 955 party colours, each under its publisher's own id for the party: PPEG's `party_id` (`FR33`) or ParlGov's `party_id` (`645`). It is ported from countries-comparison (`data/elections/party-colors.json` and `party-brands.json`, commit `b99b578`, retrieved 18 October 2026), whose `docs/parties.md` sets the rules:

- 942 colours are **representative**. countries-comparison's `scripts/build_party_colors.py` joined each exact ParlGov id, or each PPEG party's Manifesto id when no other PPEG party shares it, to one Party Facts party, then to one Wikidata item through Party Facts' crosswalk, and kept its "sRGB colour" (P465) when exactly one unqualified value has the best non-deprecated rank. An ambiguous link, several colours or a qualified colour leaves the party out. PPEG's residual codes (993 and up, such as independents) never get one. The `url` is the Wikidata item's P465 statement.
- 13 colours are a party's own **brand**, read by hand from its brand guide or logo (France and Germany). They replace the representative colour of 10 parties. The `url` is the guide or logo file.

The port changed only the shape: Eurostat geo codes became ISO3 (`EL` is `GRC`), `ppeg` and `parlgov` became the publishers `PPEG` and `ParlGov`, hex codes were upper-cased, and each entry kept its country, id, hex, kind and source URL. Party Facts and Wikidata ids, statements, methods and scopes stay in countries-comparison.

`Politics.ts` decodes the file at startup, one colour per publisher and id, and gives a government a colour only when its publisher names exactly one party as the head of government's (PPEG's `pm_party`, ParlGov's `pm` flag) and that party has a colour under the publisher's id in the same country. Records checked by hand name parties without ids, so their governments have none. Nothing is matched by a party's name.

The colours cover the 27 EU members. The other OECD members (Australia, Canada, Chile, Colombia, Costa Rica, Iceland, Israel, Japan, Korea, Mexico, New Zealand, Norway, Switzerland, Turkey, the United Kingdom, the United States) have none, so their bands stay grey.

## Licences

- Wikidata: CC0 1.0.
- Party Facts: its Harvard Dataverse releases are CC0 1.0; its crosswalk repository (`hdigital/partyfactsdata`, which holds `wikidata.csv`) is MIT. Neither file ships here, only the colours they led to.
- Brand colours: a hex value is a fact read from the party's own page; the pages themselves stay the parties' and are only linked.

To update, rebuild countries-comparison's files, then port them again the same way.
