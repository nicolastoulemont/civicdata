# Map boundaries

Most country snapshots contain selected features from Natural Earth’s 1:10m
Admin 1 GeoJSON at tag `v5.1.2`. The UK uses ONS’s 2025 statistical boundaries,
Ireland uses Tailte Éireann’s 2024 local authority boundaries, and Estonia
uses the Estonian Land and Spatial Development Board’s 12 November 2026
county snapshot, described below. Each records the full download URL (`source`),
the SHA-256 of that complete download (`sha256`) and the retrieval time
(`retrieved`). Coordinates are WGS84 longitude/latitude. Normal generation
reads these snapshots from the verified local cache; the web page loads only a projected map.
The snapshot filenames in this guide are R2 artifacts, not files committed here.
Their exact hashes and public locations are pinned in `../../src/archive.json`.
Run `pnpm --filter @repo/maps run archive restore` to restore the ignored
`packages/maps/.archive/sources` cache. See the [archive workflow](../../README.md).

Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/).
The boundary release provides geographic context, not a claim that a regional
statistical series uses these boundaries. No regional observations are added.

| Snapshot                | Displayed divisions                                 | Insets and scope                                                                                                                  |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `germany.json`          | 16 Länder                                           | All Länder, including the city states.                                                                                            |
| `united-states.json`    | 50 states and DC                                    | Alaska, Hawaii’s main islands and enlarged DC. US territories are excluded.                                                       |
| `france.json`           | 18 regions                                          | Five overseas regions in insets; other overseas collectivities are excluded.                                                      |
| `spain.json`            | 17 autonomous communities and 2 autonomous cities   | Canary Islands and enlarged Ceuta and Melilla.                                                                                    |
| `italy.json`            | 20 administrative regions                           | Trento and Bolzano remain within Trentino-Alto Adige, rather than becoming separate statistical regions.                          |
| `canada.json`           | 10 provinces and 3 territories                      | Prince Edward Island is enlarged.                                                                                                 |
| `australia-states.json` | 6 states, Northern Territory, ACT and Jervis Bay    | ACT and Jervis Bay are enlarged. External territories are excluded. This is not the ABS statistical “Other Territories” grouping. |
| `austria.json`          | 9 Länder                                            | Vienna (`Wien`) is enlarged.                                                                                                      |
| `switzerland.json`      | 26 cantons                                          | Basel-Stadt and Appenzell Innerrhoden are enlarged.                                                                               |
| `poland.json`           | 16 voivodeships                                     | Administrative divisions, not the 17 NUTS 2 statistical regions.                                                                  |
| `netherlands.json`      | 12 provinces and 3 Caribbean special municipalities | Bonaire, St. Eustatius and Saba are separate, neutral context insets.                                                             |
| `japan.json`            | 47 prefectures                                      | Okinawa and mainland Tokyo insets; Tokyo’s distant offshore islands have a supplementary inset.                                   |
| `brazil.json`           | 26 states and the Federal District                  | Distrito Federal is enlarged.                                                                                                     |
| `south-africa.json`     | 9 provinces                                         | Gauteng is enlarged; Western Cape’s offshore islands have a supplementary inset.                                                  |
| `sweden.json`           | 21 counties                                         | Stockholm and Gotland are enlarged.                                                                                               |
| `czechia.json`          | 14 regions                                          | Prague is enlarged.                                                                                                               |
| `portugal.json`         | 18 mainland districts and 2 autonomous regions      | Azores, Madeira and Madeira’s distant offshore islands have separate insets.                                                      |
| `belgium.json`          | 10 provinces plus Brussels-Capital                  | Brussels is enlarged and retains its region status.                                                                               |
| `united-kingdom.json`   | 12 ONS statistical regions                          | Nine English regions, Scotland, Wales and Northern Ireland; London is enlarged.                                                   |
| `new-zealand.json`      | 16 regions plus Chatham Islands Territory           | Chatham Islands and Nelson are enlarged; outlying island groups are neutral context.                                              |
| `argentina.json`        | 23 provinces plus Buenos Aires city                 | The autonomous city and Tierra del Fuego have separate insets.                                                                    |
| `mexico.json`           | 31 states and Mexico City                           | Enlarged capital; Guadalupe and Revillagigedo offshore insets.                                                                    |
| `romania.json`          | 41 counties and Bucharest                           | Bucharest is enlarged; Romanian county names retain their diacritics.                                                             |
| `greece.json`           | 13 regions and Mount Athos                          | Mount Athos is enlarged and labelled as a self-governed territory.                                                                |
| `hungary.json`          | 19 counties and Budapest                            | Cities are dissolved into their geographic counties; Budapest stays separate.                                                     |
| `chile.json`            | 16 regions                                          | Santiago is enlarged; Rapa Nui, Salas y Gómez, Juan Fernández and Desventuradas have offshore insets.                             |
| `colombia.json`         | 32 departments and Bogotá                           | Capital and Caribbean department insets; Malpelo has an offshore inset.                                                           |
| `ireland.json`          | 31 local authority areas                            | Tailte Éireann 2024 boundaries, including current Cork City; Dublin, Cork and Galway cities are enlarged.                         |
| `slovakia.json`         | 8 regions                                           | Bratislava region is enlarged; Slovak region names retain their diacritics.                                                       |
| `bulgaria.json`         | 28 districts                                        | Sofia City is enlarged and remains distinct from surrounding Sofia District.                                                      |
| `lithuania.json`        | 10 counties                                         | Geographic county areas with Lithuanian names, not municipal or regional government jurisdictions.                                |
| `turkiye.json`          | 81 provinces                                        | İstanbul and Yalova are enlarged; Turkish names retain their diacritics.                                                          |
| `ecuador.json`          | 24 provinces                                        | Galápagos is detached into a labelled inset.                                                                                      |
| `croatia.json`          | 20 counties and City of Zagreb                      | Corrected Požega-Slavonia identifier; Zagreb city is enlarged and remains separate from Zagreb County.                            |
| `estonia.json.gz`       | 15 counties                                         | Official current EHAK geography; Hiiu is enlarged, with all islands retained in their counties.                                   |

Inset scales differ from the main map. Small areas enlarged in insets remain
part of the main national silhouette, but their name and keyboard target occur
once, in the inset. Detached regions and offshore parts move out of the main
frame. Supplementary offshore insets show parts of existing divisions, not
additional administrative units. Country comparisons keep their regional frame.
Colours and data tables retain national observations; context insets remain neutral.

## UK statistical geography and licence

`united-kingdom.json` records the [ONS International Territorial Level 1 boundaries, January 2025](https://ckan.publishing.service.gov.uk/dataset/international-territorial-level-1-january-2025-boundaries-uk-buc),
using the publisher’s BUC version: ultra-generalised to 500 metres and clipped
to the coastline at mean high water. The query requests WGS84 (`outSR=4326`),
only `ITL125CD` and `ITL125NM`, and a stable order by code. `../ons.ts` pins the
response SHA-256 and decodes all 12 distinct identifiers. A changed response
fails refresh; it never silently replaces the checked-in boundary release.

These are statistical regions, not a uniform administrative tier. The map
labels this distinction. National observations remain national, including
when the chart shows a year before this boundary vintage. Crown Dependencies
and overseas territories are outside the ONS UK boundary set.

ONS supplies its boundaries under the [Open Government Licence v3.0](https://www.ons.gov.uk/methodology/geography/licences/),
with ONS and Ordnance Survey rights. The map and every rendered UK map preview
carry these statements:

> Source: Office for National Statistics licensed under the Open Government Licence v.3.0
>
> Contains OS data © Crown copyright and database right 2025

The preview reserves space for these credits above the observation’s existing
source line. The generated country sheet records its boundary publisher,
so UI attribution cannot accidentally fall back to Natural Earth for the UK.
GeoJSON ring winding is normalised for d3 after topology assembly.

## New Zealand and Argentina scope

The New Zealand map follows the [Stats NZ regional geography](https://infoshare.stats.govt.nz/Help/further-help.asp):
16 regions, with Chatham Islands Territory shown separately. Natural Earth
also places unassigned outlying islands and Tokelau under `adm0_a3=NZL`.
Those features are not additional regions.

Three Kings Islands, Kermadec Islands and the source’s subantarctic island
features are grouped into neutral context insets without administrative
keyboard targets or national values. The [Stats NZ geographic standard](https://www.stats.govt.nz/assets/Methods/Statistical-standard-for-geographic-areas-2023/Statistical-standard-for-geographic-areas-2023.pdf)
identifies islands outside regions, including Three Kings Islands. No such
island is reassigned to a nearby mainland region. Tokelau is explicitly omitted;
the Cook Islands and Niue are also outside this map’s scope. The snapshot
retains the original features, including the omitted feature, for auditing.

For Argentina, `AR-B` is Buenos Aires province and `AR-C` is the autonomous
city. The map uses the [23 provinces and city](https://www.argentina.gob.ar/pais/provincias),
without copying Natural Earth’s legacy `type_en` classifications for Buenos
Aires and Tierra del Fuego. Tierra del Fuego’s inset uses the source’s actual
land geometry; no Antarctic or disputed-island claims are added.

## Caribbean Netherlands coverage

The three Caribbean municipalities are parts of the Netherlands, not provinces.
They are also not Aruba, Curaçao or Sint Maarten, which are separate countries
within the Kingdom and are outside this map’s scope.

Territorial coverage depends on the indicator. [CBS national accounts for 2019](https://www.cbs.nl/-/media/_pdf/2020/29/2020a402-national-accounts-2019.pdf)
explicitly exclude Bonaire, St Eustatius and Saba; [UNdata’s Caribbean Netherlands profile](https://data.un.org/en/iso/bq.html)
also identifies the area separately for statistical purposes. The map contract
has no per-indicator territorial coverage evidence. The three insets therefore
use `coverage: "Context"`: neutral fills, no national value in their tooltips,
and a visible explanation on the chart and shared image. No regional values
are inferred, and the national series itself is unchanged.

Other insets retain the existing national-colour behaviour. A context inset
is a geographic reference, not an assertion that its value is zero or that
its statistics should be combined with another territory’s.

## Offshore framing

`offshore` in `../countries.ts` moves selected source polygons into an inset
using a geographic box. The same polygon-centroid predicate selects them out
of the main map and into the inset, so no selected part is dropped or duplicated.
The full source geometry stays in the snapshot.

Tokyo’s offshore box moves its distant Pacific islands out of the main frame;
the separate Tokyo zoom frames the mainland part. Western Cape’s offshore box
moves its southern-ocean islands into a separate panel. All 47 Japanese
prefectures and all 9 South African provinces retain one named keyboard target.

## Region grouping

Natural Earth supplies France, Spain and Italy as departments or provinces.
Generation builds their topology and dissolves shared borders within each
publisher-defined `region_cod`, using `region` for the displayed name. The
result has no internal department or province borders. Native identifiers and
names are preserved in the snapshots. Group identifiers are Natural Earth’s
codes, not a claim of current ISO or NUTS compatibility.

The following corrections are explicit in `../lands.ts`:

- Trim the trailing tab in France’s `FR-IDF` grouping code.
- Use the distinct `ES-CE` and `ES-ML` city identifiers. Natural Earth assigns
  Melilla the same `region_cod` as Ceuta; merging them would erase a division.
- Combine Lord Howe Island with New South Wales (the source already shares
  `AU-NSW`) and Macquarie Island (`AU-X03~`) with Tasmania (`AU-TAS`). Use the
  parent state’s name. Jervis Bay retains its own identifier and geometry.

Administrative scope references:

- [INSEE geography](https://www.insee.fr/fr/metadonnees/definition/c1696)
- [Eurostat administrative correspondence](https://ec.europa.eu/eurostat/web/nuts/correspondence-tables)
- [Istat regions](https://www.istat.it/statistiche-per-temi/focus/benessere-e-sostenibilita/la-misurazione-del-benessere-bes/il-bes-dei-territori/)
- [Canadian provinces and territories](https://www.canada.ca/en/intergovernmental-affairs/services/provinces-territories.html)
- [Jervis Bay administration](https://www.infrastructure.gov.au/territories-regions-cities/territories/jervis-bay-territory/governance-administration)
- [Macquarie Island, Tasmania](https://www.dcceew.gov.au/parks-heritage/heritage/places/world/macquarie-island)
- [Lord Howe Island, New South Wales](https://www.lhib.nsw.gov.au/environment/world-heritage)
- [Austrian Länder](https://www.parlament.gv.at/en/explore/political-system/the-federal-state-of-austria)
- [Swiss cantons](https://www.swissstats.bfs.admin.ch/data/webviewer/appId/ch.admin.bfs.swissstat/article/issue21000222100-27/package)
- [Polish administrative divisions](https://plwliczbach.stat.gov.pl/EN/)
- [Dutch provinces](https://english.kiesraad.nl/elections/elections-of-the-provincial-council)
- [Caribbean Netherlands](https://www.government.nl/themes/government-and-democracy/caribbean-parts-of-the-kingdom)
- [Japanese prefectures](https://www.japan.go.jp/japan/index.html)
- [Brazilian federative units](https://educa.ibge.gov.br/criancas/brasil/2850-nosso-territorio/19637-divisao-territorial.html-)
- [South African provinces](https://www.gov.za/about-sa/south-africas-provinces)
- [ABS geographic definitions](https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-4-july-2026-june-2031/methodology)

## Regeneration

Regenerate all projected maps (offline once the source cache is restored):

```sh
pnpm --filter @repo/maps run generate
pnpm format
```

Refresh the pinned sources, update the snapshots, and regenerate:

```sh
pnpm --filter @repo/maps run generate --refresh-lands
pnpm format
```

Refresh downloads Natural Earth once for its countries, the ONS response
once for the UK, five pinned Tailte Éireann pages for Ireland and the official
Estonian WFS response. Natural Earth, ONS and Tailte Éireann responses are
checked by byte hash before decoding. Estonia checks the decoded feature hash because its response envelope
contains a request timestamp.
Generation decodes each stored snapshot and checks its exact
set of subdivision and context identifiers against `../countries.ts`. Explicitly
omitted source features remain in the snapshot. An unexpected
identifier or missing division fails generation. Insets must have geometry.
To change the boundary release, review the publisher’s changes, update the
pinned URL and hash in the corresponding reader (`../lands.ts`, `../ons.ts`, `../tailte.ts` or `../landboard.ts`),
and review all maps after regenerating.

## Mexico and Romania

Mexico follows [INE's 31 states and Mexico City](https://portal.ine.mx/sobre-el-ine/sistema-politico-electoral/).
The atlas's `MX-DIF` geometry is labelled Ciudad de México; its legacy code is
kept as an internal identifier, not presented as a current ISO code.
The unnamed `MX-X01~` reef polygon lies at Arrecife Alacranes and is joined
to Yucatán, following [CONANP's location record](https://simec.conanp.gob.mx/ficha_pdf.php?anp=61&reg=9).
The source's generalised reef silhouette is geographic context, not a survey
of the reef's dry land. Guadalupe Island and Colima's Revillagigedo islands
move to labelled offshore insets. No additional state is created.

Romania follows the [41 counties and Bucharest municipality](https://european-union.europa.eu/principles-countries-history/eu-countries/romania_en).
County labels use Natural Earth's `name_en` spellings with Romanian diacritics,
recorded explicitly in `../countries.ts`; source `name` values remain unchanged
in the snapshot. Bucharest remains separate from surrounding Ilfov.

## Greece and Hungary

Greece has [13 regions](https://www.gov.gr/en/organizations/ministries/upourgeio-esoterikon/topike-autodioikese-periphereies).
[Article 105 of the Greek constitution](https://religiousaffairs.minedu.gov.gr/en/general-secretariat-for-religious-affairs/regulatory-framework/the-constitution-of-greece)
establishes Mount Athos as a self-governed part of the Greek state. It is a
separate named target, not a fourteenth region. The chart states that distinction.
The source's transliterated region labels are replaced with their English names.
Crete, the Aegean and Ionian islands remain in the main frame.

Hungary uses the [19 counties and capital](https://www.ksh.gov.hu/regionalatlas_administrative_units).
The atlas separates 23 cities with county rights from the county polygons.
`joins` in `../countries.ts` dissolves each city into its geographic county,
following the parent county in the source's `gn_name` field. These are
geographic county outlines, not a claim that cities have lost their local
administrative powers. Budapest remains separate from Pest. County labels
retain Hungarian diacritics and the current Csongrád-Csanád name.

## Chile and Colombia

Chile follows the [16 administrative regions](https://www.chile.gob.cl/en/chile/sobre-chile/asi-es-chile/organizacion-territorial/organizacion-territorial),
including Ñuble. Biobío and Aysén labels use their current spellings.
Valparaíso's Pacific islands move into four labelled supplementary insets:
Rapa Nui, Salas y Gómez, Juan Fernández and Desventuradas. The official
Magallanes region name includes Antártica Chilena, but no Antarctic claim
geometry is added to the source's South American land.

Colombia follows [32 departments and Bogotá, Distrito Capital](https://www.comunidadandina.org/quienes-somos/paises-miembros/colombia/).
The source incorrectly assigns Bogotá the same `CO-CUN` identifier as
Cundinamarca. `../lands.ts` identifies the source's `Bogota` feature by its
name and assigns `CO-DC` before grouping, so the capital cannot dissolve into
the department. The unnamed `CO-X01~` polygon at Malpelo joins Valle del Cauca,
consistent with [Parques Nacionales' management plan](https://www.parquesnacionales.gov.co/wp-content/uploads/2024/11/PM-SFF-Malpelo-2024.pdf),
and moves to a supplementary offshore inset. Legacy intendancy and commissary
classifications are not used. The San Andrés y Providencia department is
shown in a detached inset, without adding maritime claims.

## Ireland geography and licence

`ireland.json` records the [Tailte Éireann Local Authorities, National Statutory
Boundaries, Ungeneralised, 2024](https://www.arcgis.com/home/item.html?id=ed592af6f0444bf1b0becdb5925f9477).
The publisher's item specifies [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
and attribution to © Tailte Éireann. The chart links the dataset and licence;
the chart and shared preview both credit the publisher and state that geometry
has been simplified for display. Observation attribution remains visible.

The source contains 9,161 polygon parts across 31 local authorities. The reader
fetches five pages in `OBJECTID` order and pins each complete response's URL
and SHA-256 in `../tailte.ts`. WGS84 output uses five decimal places and a
maximum allowable offset of 0.0001 degrees for display simplification. Page
counts, identifiers, all 31 council names and all 9,161 distinct object IDs are
checked before generation. A truncated response cannot silently become a map.
Each page retains its own provenance in the offline snapshot.

The generator dissolves parts by the publisher's `ENG_NAME_VALUE`, used as an
internal key rather than an ISO identifier. Display names remove “Council”,
use sentence words and preserve Dún Laoghaire-Rathdown's accent. This map shows
local authority areas, not the 26 traditional counties. It includes merged
Tipperary, Limerick and Waterford councils and the [2019 Cork boundary extension](https://www.corkcity.ie/en/council-services/public-info/boundary-extension/maps-of-the-new-city/).
Northern Ireland remains part of the UK map. Tiny offshore parts that collapse
below the projected map's integer precision are not separately drawn.

## Slovakia, Bulgaria and Lithuania

Slovakia uses the [eight regions](https://ec.europa.eu/eurostat/cache/metadata/EN/reg_eco10_esms_sk.htm),
not the four larger statistical regions. Bratislavský is the entire region,
not Bratislava municipality. Prešovský and Trenčiansky labels correct the
atlas's inconsistent spelling while keeping the original snapshot properties.

Bulgaria uses [28 administrative districts](https://www.nsi.bg/en/file/35537/ATTD_RB_2025.pdf),
not the six statistical regions. Sofia City (`BG-22`) and Sofia District
(`BG-23`) have separate names and keyboard targets.

Lithuania uses [ten counties](https://osp.stat.gov.lt/en/lietuvos-regionai-2023/lietuvos-suskirstymas)
as geographic units. These are neither the two larger statistical regions nor
the 60 municipalities. Display labels use the atlas's Lithuanian `name_en`
spellings, including Klaipėda, Panevėžys, Marijampolė and Tauragė.

## Türkiye and Ecuador

Türkiye follows [TURKSTAT's 81 provinces](https://veriportali.tuik.gov.tr/en/databrowser/tuik/TR%2CDF_ADNKS_T17%2C1.1).
The map uses province boundaries, not the 26 larger statistical subregions.
Names follow the atlas's `name_en` field with Turkish spelling; İstanbul has
its dotted capital İ. This also corrects the source's `Zinguldak`, `Kinkkale`
and abbreviated `K. Maras` labels to Zonguldak, Kırıkkale and Kahramanmaraş.
İstanbul and Yalova each retain one keyboard target in their enlarged inset.

Ecuador follows the [24 provinces](https://www.censoecuador.gob.ec/public/Boletin_Nacional.htm),
including Galápagos, Santa Elena and Santo Domingo de los Tsáchilas.
The Galápagos province moves out of the mainland frame into an inset. The
source's full island geometry is retained; no sea boundary is added. Sucumbíos,
Manabí, Bolívar and Los Ríos labels retain their accents.

## Croatia identifier audit

Croatia uses [20 counties and the City of Zagreb](https://www.croatia.eu/index.php/en/home-en/political-organisation/counties).
The atlas feature `HRV-1604` has `name_en=Požega-Slavonia`, but incorrectly
repeats Brod-Posavina's `HR-12`, `name` and `gn_name` fields. The [Croatian
Bureau of Statistics' county list](https://podaci.dzs.hr/2026/en/121350)
identifies Požega-Slavonia as 11 and Slavonski Brod-Posavina as 12. `../lands.ts`
corrects only `HRV-1604` to `HR-11` before topology grouping. All Natural Earth
snapshots retain `adm1_code` so this correction refers to the native feature,
not a guessed polygon order or the duplicated labels. Source ISO fields stay
unchanged in the snapshot. Generation requires all 21 distinct targets.
Zagreb city and surrounding Zagreb County remain separate. English county
labels retain Croatian diacritics; Adriatic islands stay with their counties.

## Estonia county audit and attribution

Estonia uses the [Land and Spatial Development Board's current county polygons](https://kataster.ee/avaandmed/kaarditeenused),
queried as GeoJSON from `ehak:maakondade_piirid` over WFS. The response is
ordered by `ehak_kood`, in WGS84 longitude/latitude. The source's 15 current
EHAK county codes differ from several legacy ISO fields in the atlas, so
this map does not use or relabel the old atlas geometry.

`../landboard.ts` freezes the features read on 12 November 2026. It checks all
15 distinct EHAK codes, the active county type, the declared CRS and both
publisher feature counts. Each feature retains its boundary version start
and legal basis (`vers_algus`, `vers_lopp`, `seaduslik_alus`).

GeoServer adds a fresh request timestamp to its envelope. The reader therefore
pins SHA-256 over `JSON.stringify` of the Schema-decoded feature array, including
the version and legal-basis fields. Only the envelope timestamp can vary during
refresh: changed geometry, names, identifiers or version metadata fail refresh.
The snapshot also records the complete response's SHA-256, server timestamp,
retrieval time, URL and validity date. `estonia.json.gz` is gzip-compressed JSON
to preserve the detailed publisher geometry without a large text export.
Offline generation decodes it and rechecks the pinned feature hash.

The [publisher's terms](https://geoportaal.maaruum.ee/eng/spatial-data/administrative-and-settlement-division-p312.html)
require its name and the data's validity date. Both the chart and every drawn
shared map carry “Boundaries: Estonian Land and Spatial Development Board,
12 November 2026.” The chart also links the publisher. Observation source
attribution remains separate and visible. Hiiu's inset is enlarged; Saare
and other island parts remain in their geographic county on the main map.
Tiny polygons below projected integer precision are not separately drawn.

## Fifty-country expansion, 12 November 2026

This batch adds the following 50 maps, for 85 national maps in total. These
are geographic subdivisions of a national observation, not regional data.
Every named subdivision has one accessible target; enlarged insets reuse
that target rather than creating a second area. Current boundaries also
appear when viewing older observations. The boundary vintage is separate
from the observation year.

| Country                      | Areas | Displayed divisions                                                             | Snapshot                       | Boundary publisher                                                                                             |
| ---------------------------- | ----: | ------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Albania (`ALB`)              |    12 | 12 counties                                                                     | `albania.json`                 | Natural Earth v5.1.2                                                                                           |
| Algeria (`DZA`)              |    69 | 69 wilayas                                                                      | `algeria.json.gz`              | GeoAlgeria / OpenStreetMap contributors                                                                        |
| Armenia (`ARM`)              |    11 | 10 provinces and Yerevan                                                        | `armenia.json`                 | Natural Earth v5.1.2                                                                                           |
| Bangladesh (`BGD`)           |     8 | 8 divisions                                                                     | `bangladesh.json.gz`           | geoBoundaries                                                                                                  |
| Bolivia (`BOL`)              |     9 | 9 departments                                                                   | `bolivia.json`                 | Natural Earth v5.1.2                                                                                           |
| Costa Rica (`CRI`)           |     7 | 7 provinces                                                                     | `costa-rica.json`              | Natural Earth v5.1.2                                                                                           |
| Denmark (`DNK`)              |     5 | 5 regions                                                                       | `denmark.json`                 | Natural Earth v5.1.2                                                                                           |
| Dominican Republic (`DOM`)   |    32 | 31 provinces and the National District                                          | `dominican-republic.json`      | Natural Earth v5.1.2                                                                                           |
| Egypt, Arab Rep. (`EGY`)     |    27 | 27 governorates                                                                 | `egypt.json`                   | Natural Earth v5.1.2                                                                                           |
| El Salvador (`SLV`)          |    14 | 14 departments                                                                  | `el-salvador.json`             | Natural Earth v5.1.2                                                                                           |
| Finland (`FIN`)              |    19 | 19 regions, including Åland                                                     | `finland.json.gz`              | Statistics Finland                                                                                             |
| Georgia (`GEO`)              |    12 | 9 regions, 2 autonomous republics and Tbilisi                                   | `georgia.json`                 | Natural Earth v5.1.2                                                                                           |
| Ghana (`GHA`)                |    16 | 16 regions                                                                      | `ghana.json.gz`                | OCHA / Ghana Statistical Services (GSS)                                                                        |
| Guatemala (`GTM`)            |    22 | 22 departments                                                                  | `guatemala.json`               | Natural Earth v5.1.2                                                                                           |
| Honduras (`HND`)             |    18 | 18 departments                                                                  | `honduras.json`                | Natural Earth v5.1.2                                                                                           |
| Iceland (`ISL`)              |     8 | 8 statistical regions                                                           | `iceland.json`                 | Natural Earth v5.1.2                                                                                           |
| India (`IND`)                |    36 | 28 states and 8 union territories                                               | `india.json`                   | Natural Earth v5.1.2                                                                                           |
| Indonesia (`IDN`)            |    38 | 38 provinces                                                                    | `indonesia.json.gz`            | Deny Herianto                                                                                                  |
| Jordan (`JOR`)               |    12 | 12 governorates                                                                 | `jordan.json`                  | Natural Earth v5.1.2                                                                                           |
| Kazakhstan (`KAZ`)           |    20 | 17 regions and 3 cities of republican significance                              | `kazakhstan.json.gz`           | OCHA / UNHCR / OpenStreetMap contributors                                                                      |
| Kenya (`KEN`)                |    47 | 47 counties                                                                     | `kenya.json.gz`                | OCHA / IEBC                                                                                                    |
| Korea, Rep. (`KOR`)          |    16 | 16 first-level units                                                            | `south-korea.json.gz`          | Statistics Korea SGIS / vuski/admdongkor                                                                       |
| Kyrgyz Republic (`KGZ`)      |     9 | 7 regions, Bishkek and Osh                                                      | `kyrgyzstan.json.gz`           | OCHA / Ministry of Emergency Situations of the Kyrgyz Republic                                                 |
| Latvia (`LVA`)               |    42 | 42 municipalities and state cities                                              | `latvia.json.gz`               | geoBoundaries / Geoportal of Latvia                                                                            |
| Luxembourg (`LUX`)           |    12 | 12 cantons                                                                      | `luxembourg.json.gz`           | Administration du cadastre et de la topographie                                                                |
| Malaysia (`MYS`)             |    16 | 13 states and 3 federal territories                                             | `malaysia.json`                | Natural Earth v5.1.2                                                                                           |
| Malta (`MLT`)                |     6 | 6 regional councils                                                             | `malta.json.gz`                | geoBoundaries / Malta Address Registrar                                                                        |
| Mongolia (`MNG`)             |    22 | 21 aimags and Ulaanbaatar                                                       | `mongolia.json`                | Natural Earth v5.1.2                                                                                           |
| Namibia (`NAM`)              |    14 | 14 regions                                                                      | `namibia.json.gz`              | OCHA / Namibia Statistics Agency (NSA)                                                                         |
| Nepal (`NPL`)                |     7 | 7 provinces                                                                     | `nepal.json.gz`                | OCHA / Survey Department of Nepal (http://ngiip.gov.np/index.php), UN Resident Coordinators Office in Nepal (h |
| Nicaragua (`NIC`)            |    17 | 15 departments and 2 autonomous regions                                         | `nicaragua.json`               | Natural Earth v5.1.2                                                                                           |
| Nigeria (`NGA`)              |    37 | 36 states and the Federal Capital Territory                                     | `nigeria.json`                 | Natural Earth v5.1.2                                                                                           |
| North Macedonia (`MKD`)      |     8 | 8 statistical regions                                                           | `north-macedonia.json.gz`      | geoBoundaries / NTES                                                                                           |
| Norway (`NOR`)               |    15 | 15 mainland counties                                                            | `norway.json.gz`               | Kartverket                                                                                                     |
| Paraguay (`PRY`)             |    18 | 17 departments and Asunción                                                     | `paraguay.json`                | Natural Earth v5.1.2                                                                                           |
| Peru (`PER`)                 |    26 | 24 departments, Callao and Lima Province                                        | `peru.json`                    | Natural Earth v5.1.2                                                                                           |
| Philippines (`PHL`)          |   122 | 82 provinces, 38 independent cities, Pateros and Special Geographic Area        | `philippines.json.gz`          | NAMRIA / PSA via bendlikeabamboo                                                                               |
| Rwanda (`RWA`)               |     5 | 4 provinces and Kigali                                                          | `rwanda.json`                  | Natural Earth v5.1.2                                                                                           |
| Saudi Arabia (`SAU`)         |    13 | 13 regions                                                                      | `saudi-arabia.json`            | Natural Earth v5.1.2                                                                                           |
| Senegal (`SEN`)              |    14 | 14 regions                                                                      | `senegal.json`                 | Natural Earth v5.1.2                                                                                           |
| Slovenia (`SVN`)             |    12 | 12 statistical regions                                                          | `slovenia.json.gz`             | Geodetska uprava Republike Slovenije                                                                           |
| Sri Lanka (`LKA`)            |     9 | 9 provinces                                                                     | `sri-lanka.json`               | Natural Earth v5.1.2                                                                                           |
| Tajikistan (`TJK`)           |     5 | 2 regions, Gorno-Badakhshan, Dushanbe and districts of republican subordination | `tajikistan.json`              | Natural Earth v5.1.2                                                                                           |
| Thailand (`THA`)             |    77 | 76 provinces and Bangkok                                                        | `thailand.json`                | Natural Earth v5.1.2                                                                                           |
| Tunisia (`TUN`)              |    24 | 24 governorates                                                                 | `tunisia.json.gz`              | OCHA / Institut National de la Statistique Tunisie                                                             |
| United Arab Emirates (`ARE`) |     7 | 7 emirates                                                                      | `united-arab-emirates.json.gz` | geoBoundaries / OpenStreetMap contributors                                                                     |
| Uruguay (`URY`)              |    19 | 19 departments                                                                  | `uruguay.json`                 | Natural Earth v5.1.2                                                                                           |
| Uzbekistan (`UZB`)           |    14 | 12 regions, Karakalpakstan and Tashkent city                                    | `uzbekistan.json`              | Natural Earth v5.1.2                                                                                           |
| Viet Nam (`VNM`)             |    34 | 34 provincial-level units                                                       | `vietnam.json.gz`              | OCHA / General Statistics Office of Vietnam (GSO)                                                              |
| Zambia (`ZMB`)               |    10 | 10 provinces                                                                    | `zambia.json`                  | Natural Earth v5.1.2                                                                                           |

### Current divisions and source corrections

- Peru: the atlas repeats `PE-LIM` for Lima Department and Lima Province.
  Native feature `PER-587` is assigned `PE-LMA` before grouping. The original
  source properties remain in the snapshot. Callao is separate. See
  [INEI's territorial description](https://www.inei.gob.pe/media/MenuRecursivo/publicaciones_digitales/Est/Lib1806/files/basic-html/page16.html).
- Paraguay includes Asunción separately from its 17 departments. The
  Dominican Republic includes the National District separately from its
  31 provinces. Nicaragua's Caribbean autonomous regions use their current
  names. El Salvador's municipality reform does not change its 14 departments.
- Denmark retains the five regions in force in November 2026. The
  [Eastern Denmark merger](https://www.regionh.dk/english/politics/The-Region-of-Eastern-Denmark/Pages/About-the-Region-of-Eastern-Denmark.aspx)
  takes effect in January 2027. Greenland and the Faroe Islands are outside
  this Danish region geography.
- Norway uses [Kartverket's 15 current mainland counties](https://www.kartverket.no/til-lands/fakta-om-norge/norske-fylke-og-kommunar),
  fetched individually from Kommuneinfo. Oslo is enlarged. Svalbard and
  Jan Mayen are outside this county geography and are explicitly excluded.
- Finland uses Statistics Finland's 2026 region WFS layer, including Åland.
  Luxembourg uses the ACT cantons collection inside `limadmin.geojson`.
  Slovenia uses GURS's current statistical-region service. Iceland and
  North Macedonia also use statistical regions, not a common administrative tier.
- Latvia joins Varakļāni to Madona, following the
  [1 July 2025 merger](https://www.varam.gov.lv/lv/informacija-par-42-pasvaldibam).
  The 2021 source's 43 polygons therefore produce 42 areas.
- Malta joins 68 council polygons into the six regions listed by the
  [Malta Address Registrar](https://address.gov.mt/local-council/). Native
  shape IDs identify polygons because the source repeats ISO codes and swaps
  the Xagħra/Xgħajra labels between islands. Geographic membership corrects
  those labels before grouping. Gozo has its own detached inset.
- India includes Ladakh, Telangana and the merged Dadra and Nagar Haveli and
  Daman and Diu territory. The atlas's legacy `type_en` field is not used to
  classify the 28 states and eight union territories. Geometry follows the
  source's territorial portrayal, not a determination of disputed sovereignty.
- Sri Lanka dissolves the source districts into nine provinces using native
  province codes. Malaysia keeps all three federal territories; Thailand
  keeps Bangkok separate from its 76 provinces.
- Georgia shows Abkhazia as neutral context. Regional outlines do not establish
  statistical coverage or territorial control. In particular, national data
  can exclude Abkhazia and the Tskhinvali region/South Ossetia. The note stays
  visible beside the chart. These are geographic regions, not regional values.
- Kazakhstan uses UNHCR's 2023 geography: 17 regions and Almaty, Astana and
  Shymkent. This includes Abay, Jetisu and Ulytau. Kyrgyzstan keeps Bishkek
  and Osh separate, both enlarged in insets. Uzbekistan keeps Tashkent city and region separate.
- Vietnam uses the GSO/OCHA September 2025 release with
  [34 provincial-level units](https://en.baochinhphu.vn/names-and-administrative-centers-of-34-provinces-and-centrally-run-cities-specified-111250415094350491.htm).
  Offshore geometry follows the source and does not resolve territorial claims.
- Indonesia uses Deny Herianto's 38-province derivative. All six Papua-region
  provinces and North Kalimantan are present. The source repeats `91` and
  `92` across the new Papua provinces. A name-to-code crosswalk assigns the
  four new provinces `93`–`96`, retaining the original fields for audit. The
  importer requires all 38 distinct targets. Its community geometry is not
  represented as an official boundary survey. [BIG's 2025 release](https://www.big.go.id/en/content/press-release/rilis-peta-nkri-edisi-tahun-2025-mempertegas-batas-identitas-dan-masa-depan-indonesia)
  independently confirms the 38-province geography.
- South Korea uses vuski/admdongkor's October 2026 release, derived from SGIS.
  Its 3,559 administrative-dong features are dissolved by native `sido` code
  into 16 units. This incorporates Gunwi's reassignment to Daegu and the
  [July 2026 Jeonnam-Gwangju merger](https://www.investkorea.org/gj-en/bbs/i-1416/detail.do?ntt_sn=491523).
  Jeju is detached; Seoul and Sejong are enlarged. English labels follow the
  native first-level code, with the Korean properties retained per member.
- The Philippines uses bendlikeabamboo's simplified NAMRIA/PSA November 2023
  municipal geometry, pinned to a repository commit. This avoids loading the
  2025 HDX bundle's one-gigabyte archive for the same provincial grouping.
  Each municipality joins its province except the PSA's
  [33 highly urbanized cities](https://psa.gov.ph/classification/psgc/hucs),
  [five independent component cities](https://psa.gov.ph/classification/psgc/iccs),
  Pateros and the Special Geographic Area. Isabela City joins Basilan despite
  its different regional affiliation. The four Manila districts dissolve into
  their cities; the eight SGA pieces form one named geographic area. The
  resulting 122 areas form a partition, without province/city overlays.
  Internal municipal changes do not become provincial boundaries. Source
  simplification is Douglas–Peucker at 0.005 degrees, suitable for display,
  not surveying. The older regional assignments do not affect these groups.
- Ghana uses all 16 regions; Namibia uses all 14. Kenya uses 47 counties.
  Tunisia takes its 24 governorates from the source's **admin2** collection;
  its six admin1 macroregions are not governorates.
- Algeria uses GeoAlgeria's September 2026 OSM-derived 69-wilaya geometry,
  including its documented commune-membership corrections. It follows
  [Law 26-06](https://www.joradp.dz/FTP/JO-FRANCAIS/2026/F2026025.pdf).
  The new wilayas' transfer of powers continues through December 2026.

### External boundary manifests and reproduction

`../boundaries.json` holds the exact input URLs, archive member names, native
code/name fields, label corrections, joins, publisher, vintage and licence.
`../boundaries.ts` decodes GeoJSON, selected ZIP members, zipped shapefiles
and Norway's county response through Effect Schema. The reader rejects wrong
country metadata, missing or extra division codes and changed content hashes.
The input collection must contain polygon geometry with finite coordinates.
The publisher's original selected attributes remain in each snapshot. When
several features form one division, their interior edges are dissolved before
pinning and their attributes remain under `native.members`.

A `.json.gz` snapshot records each input's complete response SHA-256,
retrieval time and normalized selected-feature hash. The normalized hash
covers the displayed geometry, names, codes and original member attributes.
Request timestamps outside those features cannot silently select a new release.
For changing WFS endpoints, a changed feature hash fails refresh. Snapshot
readers recompute the feature hash during ordinary offline generation.

From the repository root:

```sh
pnpm --filter @repo/web maps
pnpm --filter @repo/web glyphs
pnpm format
```

These commands use only checked-in source snapshots and installed packages.
To fetch and verify all publisher inputs, use `maps --refresh-lands`. A new
external source starts with `hash: "pending"`; after auditing its geography,
`maps --pin-boundaries` pins only those pending inputs. To change an existing
release deliberately, mark its input hash pending, audit the replacement and
regenerate. Pin mode does not silently update already pinned sources.

### External data licences

Publisher credits, boundary vintage, licence and adaptation notice remain in
the interactive map and rendered PNG, separate from observation attribution.
Long PNG credits wrap within the image. Source links and complete input URLs
are retained in the manifest and source snapshots.

- Kartverket, Statistics Finland and Slovenia GURS: CC BY 4.0. Luxembourg ACT:
  CC0. The geoBoundaries manifest records the supplied licences for Latvia
  and North Macedonia (CC BY 4.0), Bangladesh (CC0), and Malta (public domain).
  Malta's regional membership table is attributed to the Address Registrar.
- OCHA COD-AB releases for Vietnam, Nepal, Kyrgyzstan, Kenya, Ghana, Namibia
  and Tunisia: [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/),
  with the originating agency credited. The Philippine boundaries originate
  in the same NAMRIA/PSA COD-AB source; the simplification and enrichment are
  attributed to bendlikeabamboo. Its MIT software licence is not substituted
  for the boundary data's upstream terms.
- Indonesia: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as
  specified in Deny Herianto's `DATA_LICENSE.md`. Its declared upstream
  provenance is limited; the map is display geography, not an official survey.
- South Korea: **Statistics Korea SGIS / vuski/admdongkor**, CC BY 4.0, with
  upstream [Korea Open Government License Type 1](https://www.kogl.or.kr/info/licenseType1.do).
  The source's required attribution is preserved here:

  > This data is derived from administrative-dong boundaries released by Statistics
  > Korea SGIS (https://sgis.kostat.go.kr) under KOGL Type 1, modified by
  > vuski/admdongkor (https://github.com/vuski/admdongkor), distributed under CC BY 4.0.

- **OpenStreetMap contributors**, via geoBoundaries for the United Arab
  Emirates, OCHA/UNHCR for Kazakhstan, and GeoAlgeria for Algeria:
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). This attribution
  and licence follow these data despite broader repository or HDX metadata
  licences. The corresponding `.json.gz` snapshots and generated map geometry
  are adapted databases offered under ODbL 1.0. They contain all coordinates
  and source-member attributes used to build the maps. Each chart offers a
  download at `/boundaries/{ISO3}.zip`: the selected source snapshot, projected
  display areas and insets, and a notice with publisher and licence links.
  These three archives are generated in `packages/maps/.archive/downloads/` with
  fixed ZIP timestamps. The shared PNG also carries the download and licence
  URLs. The source URLs plus
  the checked-in joins and projection script provide the reconstruction path.
  Other countries' data and the application's code retain their own licences.

These are simplified geographic displays. Tiny polygons can collapse at the
map's integer precision, and border details can differ between publishers.
They do not establish legal borders, territorial control, statistical coverage
or local observations. Regional and world comparison frames are unchanged.

## Hundred-country expansion, 13 November 2026

This batch adds 100 country/economy maps, bringing the supported total to 185.
The user required current arrangements. Outdated arrangements are replaced,
not published as historical alternatives. Older geometry is retained only
where the selected tier's division structure remains applicable. This is
not a claim that every coastline was surveyed in 2026: publisher vintages
remain visible and the outlines are simplified for display. Geographic and
statistical tiers are identified below; they are not all local-government tiers.
No regional observations or territorial-control claims are introduced.

| Country/economy                        | Named areas | Geography                                                    | Generated map ID                   | Source                                                                                                        |
| -------------------------------------- | ----------: | ------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Afghanistan (`AFG`)                    |          34 | Named current subdivision areas                              | `afghanistan`                      | Natural Earth v5.1.2                                                                                          |
| American Samoa (`ASM`)                 |           5 | Named current subdivision areas                              | `american-samoa`                   | Natural Earth v5.1.2                                                                                          |
| Andorra (`AND`)                        |           7 | Named current subdivision areas                              | `andorra`                          | Natural Earth v5.1.2                                                                                          |
| Antigua and Barbuda (`ATG`)            |           8 | Named current subdivision areas                              | `antigua-and-barbuda`              | Natural Earth v5.1.2                                                                                          |
| Bahamas, The (`BHS`)                   |          32 | Named current subdivision areas                              | `bahamas`                          | geoBoundaries                                                                                                 |
| Bahrain (`BHR`)                        |           4 | Named current subdivision areas                              | `bahrain`                          | geoBoundaries / OpenStreetMap contributors                                                                    |
| Barbados (`BRB`)                       |          11 | Named current subdivision areas                              | `barbados`                         | Natural Earth v5.1.2                                                                                          |
| Belarus (`BLR`)                        |           7 | Named current subdivision areas                              | `belarus`                          | Natural Earth v5.1.2                                                                                          |
| Belize (`BLZ`)                         |           6 | Named current subdivision areas                              | `belize`                           | Natural Earth v5.1.2                                                                                          |
| Benin (`BEN`)                          |          12 | Named current subdivision areas                              | `benin`                            | Natural Earth v5.1.2                                                                                          |
| Bermuda (`BMU`)                        |          11 | Named current subdivision areas                              | `bermuda`                          | Natural Earth v5.1.2                                                                                          |
| Bhutan (`BTN`)                         |          20 | Named current subdivision areas                              | `bhutan`                           | Natural Earth v5.1.2                                                                                          |
| Bosnia and Herzegovina (`BIH`)         |           3 | Named current subdivision areas                              | `bosnia-and-herzegovina`           | geoBoundaries                                                                                                 |
| Brunei Darussalam (`BRN`)              |           4 | Named current subdivision areas                              | `brunei`                           | Natural Earth v5.1.2                                                                                          |
| Burkina Faso (`BFA`)                   |          17 | 17 regions                                                   | `burkina-faso`                     | OCHA / Institut Geographique Burkina (IGB)                                                                    |
| Burundi (`BDI`)                        |           5 | five provinces                                               | `burundi`                          | OCHA / Bureau de Centralisation de Géomatique (BCG)                                                           |
| Cabo Verde (`CPV`)                     |          22 | Named current subdivision areas                              | `cabo-verde`                       | Natural Earth v5.1.2                                                                                          |
| Cambodia (`KHM`)                       |          25 | Named current subdivision areas                              | `cambodia`                         | OCHA / Department of Geography of the Ministry of Land Management, Urbanization and Construction in 2008, WFP |
| Cameroon (`CMR`)                       |          10 | Named current subdivision areas                              | `cameroon`                         | Natural Earth v5.1.2                                                                                          |
| Central African Republic (`CAF`)       |          20 | 20 prefecture-level areas                                    | `central-african-republic`         | OCHA / ICASEES                                                                                                |
| Chad (`TCD`)                           |          23 | Named current subdivision areas                              | `chad`                             | OCHA / Institut National de la Statistique, des Etudes Economiques et Démographiques du Tchad                 |
| Channel Islands (`CHI`)                |           2 | two bailiwicks                                               | `channel-islands`                  | Natural Earth v5.1.2                                                                                          |
| China (`CHN`)                          |          31 | 31 mainland province-level areas                             | `china`                            | geoBoundaries                                                                                                 |
| Comoros (`COM`)                        |           3 | Named current subdivision areas                              | `comoros`                          | Natural Earth v5.1.2                                                                                          |
| Congo, Dem. Rep. (`COD`)               |          26 | 26 provinces                                                 | `democratic-republic-of-congo`     | OCHA / Referenciel Géographique Commun                                                                        |
| Cote d'Ivoire (`CIV`)                  |          33 | 31 regions and two autonomous districts                      | `cote-divoire`                     | OCHA / Comité National de Télédétection et d'Information Géographique (CNTIG)                                 |
| Cuba (`CUB`)                           |          16 | Named current subdivision areas                              | `cuba`                             | Natural Earth v5.1.2                                                                                          |
| Cyprus (`CYP`)                         |           6 | Named current subdivision areas                              | `cyprus`                           | geoBoundaries / OpenStreetMap contributors                                                                    |
| Djibouti (`DJI`)                       |           6 | Named current subdivision areas                              | `djibouti`                         | Natural Earth v5.1.2                                                                                          |
| Dominica (`DMA`)                       |          10 | Named current subdivision areas                              | `dominica`                         | Natural Earth v5.1.2                                                                                          |
| Eritrea (`ERI`)                        |           6 | Named current subdivision areas                              | `eritrea`                          | Natural Earth v5.1.2                                                                                          |
| Eswatini (`SWZ`)                       |           4 | Named current subdivision areas                              | `eswatini`                         | Natural Earth v5.1.2                                                                                          |
| Ethiopia (`ETH`)                       |          14 | 12 regions and two cities; contested area is context         | `ethiopia`                         | OCHA / CSA (Central Statistics Agency) + Regional Bureau of Finance and Economic Development (BoFED)          |
| Fiji (`FJI`)                           |           5 | Named current subdivision areas                              | `fiji`                             | Natural Earth v5.1.2                                                                                          |
| French Polynesia (`PYF`)               |           5 | Named current subdivision areas                              | `french-polynesia`                 | Natural Earth v5.1.2                                                                                          |
| Gabon (`GAB`)                          |           9 | Named current subdivision areas                              | `gabon`                            | Natural Earth v5.1.2                                                                                          |
| Gambia, The (`GMB`)                    |           6 | Named current subdivision areas                              | `gambia-the`                       | Natural Earth v5.1.2                                                                                          |
| Greenland (`GRL`)                      |           6 | five municipalities and National Park (context)              | `greenland`                        | geoBoundaries                                                                                                 |
| Grenada (`GRD`)                        |           7 | Named current subdivision areas                              | `grenada`                          | Natural Earth v5.1.2                                                                                          |
| Guinea (`GIN`)                         |          34 | Named current subdivision areas                              | `guinea`                           | Natural Earth v5.1.2                                                                                          |
| Guinea-Bissau (`GNB`)                  |           9 | Named current subdivision areas                              | `guinea-bissau`                    | Natural Earth v5.1.2                                                                                          |
| Guyana (`GUY`)                         |          10 | Named current subdivision areas                              | `guyana`                           | Natural Earth v5.1.2                                                                                          |
| Haiti (`HTI`)                          |          10 | Named current subdivision areas                              | `haiti`                            | Natural Earth v5.1.2                                                                                          |
| Hong Kong SAR, China (`HKG`)           |          18 | Named current subdivision areas                              | `hong-kong-sar-china`              | Natural Earth v5.1.2                                                                                          |
| Iran, Islamic Rep. (`IRN`)             |          31 | Named current subdivision areas                              | `iran`                             | Natural Earth v5.1.2                                                                                          |
| Israel (`ISR`)                         |           6 | Named current subdivision areas                              | `israel`                           | geoBoundaries                                                                                                 |
| Jamaica (`JAM`)                        |          14 | Named current subdivision areas                              | `jamaica`                          | Natural Earth v5.1.2                                                                                          |
| Kiribati (`KIR`)                       |           3 | three geographic island groups                               | `kiribati`                         | geoBoundaries / OpenStreetMap contributors                                                                    |
| Kuwait (`KWT`)                         |           6 | Named current subdivision areas                              | `kuwait`                           | Natural Earth v5.1.2                                                                                          |
| Lao PDR (`LAO`)                        |          18 | Named current subdivision areas                              | `laos`                             | OCHA / National Geographic Department (NGD)                                                                   |
| Lebanon (`LBN`)                        |           9 | Named current subdivision areas                              | `lebanon`                          | geoBoundaries                                                                                                 |
| Lesotho (`LSO`)                        |          10 | Named current subdivision areas                              | `lesotho`                          | Natural Earth v5.1.2                                                                                          |
| Liberia (`LBR`)                        |          15 | Named current subdivision areas                              | `liberia`                          | Natural Earth v5.1.2                                                                                          |
| Liechtenstein (`LIE`)                  |          11 | Named current subdivision areas                              | `liechtenstein`                    | Natural Earth v5.1.2                                                                                          |
| Madagascar (`MDG`)                     |          24 | 24 regions, including Ambatosoa                              | `madagascar`                       | OCHA / Bureau National de Gestion des Risuqes et Catastrphe (BNGRC)                                           |
| Malawi (`MWI`)                         |          28 | Named current subdivision areas                              | `malawi`                           | Natural Earth v5.1.2                                                                                          |
| Maldives (`MDV`)                       |          21 | 20 atoll areas and Malé                                      | `maldives`                         | geoBoundaries / OpenStreetMap contributors                                                                    |
| Mali (`MLI`)                           |          20 | Named current subdivision areas                              | `mali`                             | OCHA / Mali Institut Géographique (IGM)                                                                       |
| Marshall Islands (`MHL`)               |          24 | 24 local-government island areas                             | `marshall-islands`                 | geoBoundaries / OpenStreetMap contributors                                                                    |
| Mauritania (`MRT`)                     |          15 | Named current subdivision areas                              | `mauritania`                       | OCHA / Agence Nationale de la Statistique, de l'Analyse Démographique et Economique (ANSADE)                  |
| Mauritius (`MUS`)                      |          12 | Named current subdivision areas                              | `mauritius`                        | geoBoundaries / OpenStreetMap contributors                                                                    |
| Micronesia, Fed. Sts. (`FSM`)          |           4 | Named current subdivision areas                              | `micronesia`                       | Natural Earth v5.1.2                                                                                          |
| Moldova (`MDA`)                        |          37 | Named current subdivision areas                              | `moldova`                          | geoBoundaries                                                                                                 |
| Mozambique (`MOZ`)                     |          11 | Named current subdivision areas                              | `mozambique`                       | Natural Earth v5.1.2                                                                                          |
| Myanmar (`MMR`)                        |          15 | seven states, seven regions and Nay Pyi Taw                  | `myanmar`                          | OCHA / Myanmar Information Management Unit (MIMU)                                                             |
| Naoero (`NRU`)                         |          14 | Named current subdivision areas                              | `naoero`                           | Natural Earth v5.1.2                                                                                          |
| New Caledonia (`NCL`)                  |           3 | Named current subdivision areas                              | `new-caledonia`                    | Natural Earth v5.1.2                                                                                          |
| Niger (`NER`)                          |           8 | Named current subdivision areas                              | `niger`                            | Natural Earth v5.1.2                                                                                          |
| Oman (`OMN`)                           |          11 | Named current subdivision areas                              | `oman`                             | Natural Earth v5.1.2                                                                                          |
| Pakistan (`PAK`)                       |           7 | Named current subdivision areas                              | `pakistan`                         | geoBoundaries                                                                                                 |
| Palau (`PLW`)                          |          16 | Named current subdivision areas                              | `palau`                            | Natural Earth v5.1.2                                                                                          |
| Papua New Guinea (`PNG`)               |          22 | Named current subdivision areas                              | `papua-new-guinea`                 | OCHA / Papua New Guinea National Statistics Office                                                            |
| Qatar (`QAT`)                          |           8 | Named current subdivision areas                              | `qatar`                            | OCHA / Qatar planning and statistics authority                                                                |
| Samoa (`WSM`)                          |          11 | Named current subdivision areas                              | `samoa`                            | Natural Earth v5.1.2                                                                                          |
| San Marino (`SMR`)                     |           9 | Named current subdivision areas                              | `san-marino`                       | Natural Earth v5.1.2                                                                                          |
| Sao Tome and Principe (`STP`)          |           2 | two island areas                                             | `sao-tome-and-principe`            | geoBoundaries / OpenStreetMap contributors                                                                    |
| Serbia (`SRB`)                         |          25 | Named current subdivision areas                              | `serbia`                           | Natural Earth v5.1.2                                                                                          |
| Sierra Leone (`SLE`)                   |           5 | Named current subdivision areas                              | `sierra-leone`                     | OCHA / Government of Sierra Leone                                                                             |
| Singapore (`SGP`)                      |           5 | Named current subdivision areas                              | `singapore`                        | Natural Earth v5.1.2                                                                                          |
| Solomon Islands (`SLB`)                |          10 | Named current subdivision areas                              | `solomon-islands`                  | Natural Earth v5.1.2                                                                                          |
| Somalia, Fed. Rep. (`SOM`)             |          18 | Named current subdivision areas                              | `somalia-fed-rep`                  | geoBoundaries / OpenStreetMap contributors                                                                    |
| St. Kitts and Nevis (`KNA`)            |          14 | Named current subdivision areas                              | `saint-kitts-and-nevis`            | Natural Earth v5.1.2                                                                                          |
| St. Lucia (`LCA`)                      |          10 | Named current subdivision areas                              | `st-lucia`                         | geoBoundaries                                                                                                 |
| St. Vincent and the Grenadines (`VCT`) |           6 | Named current subdivision areas                              | `saint-vincent-and-the-grenadines` | Natural Earth v5.1.2                                                                                          |
| Sudan (`SDN`)                          |          18 | 18 states; Abyei is context                                  | `sudan`                            | OCHA / Information Management Working Group (IMWG), OCHA                                                      |
| Suriname (`SUR`)                       |          10 | Named current subdivision areas                              | `suriname`                         | Natural Earth v5.1.2                                                                                          |
| Syrian Arab Republic (`SYR`)           |          14 | Named current subdivision areas                              | `syria`                            | geoBoundaries                                                                                                 |
| Tanzania (`TZA`)                       |          31 | 31 regions                                                   | `tanzania`                         | OCHA / Tanzania National Bureau of Statistics / UN OCHA ROSA                                                  |
| Timor-Leste (`TLS`)                    |          14 | 13 municipalities and Oecusse special area, including Ataúro | `timor-leste`                      | OCHA / WHO                                                                                                    |
| Togo (`TGO`)                           |           5 | five geographic regions                                      | `togo`                             | Natural Earth v5.1.2                                                                                          |
| Tonga (`TON`)                          |           5 | Named current subdivision areas                              | `tonga`                            | Natural Earth v5.1.2                                                                                          |
| Trinidad and Tobago (`TTO`)            |          15 | 14 Trinidad municipal areas and Tobago                       | `trinidad-and-tobago`              | Natural Earth v5.1.2                                                                                          |
| Turks and Caicos Islands (`TCA`)       |           6 | Named current subdivision areas                              | `turks-and-caicos-islands`         | Natural Earth v5.1.2                                                                                          |
| Uganda (`UGA`)                         |           4 | four geographic regions                                      | `uganda`                           | OCHA / Uganda Bureau of Statistics with support from WHO                                                      |
| Vanuatu (`VUT`)                        |           6 | Named current subdivision areas                              | `vanuatu`                          | Natural Earth v5.1.2                                                                                          |
| Venezuela, RB (`VEN`)                  |          25 | Named current subdivision areas                              | `venezuela`                        | Natural Earth v5.1.2                                                                                          |
| Virgin Islands (U.S.) (`VIR`)          |           3 | Named current subdivision areas                              | `us-virgin-islands`                | Natural Earth v5.1.2                                                                                          |
| West Bank and Gaza (`PSE`)             |           2 | West Bank and Gaza geographic areas                          | `west-bank-and-gaza`               | geoBoundaries                                                                                                 |
| Yemen, Rep. (`YEM`)                    |          22 | Named current subdivision areas                              | `yemen-rep`                        | OCHA / Central Statistical Organization (CSO)                                                                 |
| Zimbabwe (`ZWE`)                       |          10 | Named current subdivision areas                              | `zimbabwe`                         | Natural Earth v5.1.2                                                                                          |

### Reform audit

- Burundi uses the new five-province COD-AB release. Burkina Faso uses the
  [17 regions established in July 2025](https://www.presidencedufaso.bf/conseil-des-ministres-du-2-juillet-2025/),
  replacing the old 13-region/45-province atlas arrangement. Mali uses its
  20 first-level areas. DR Congo uses 26 provinces, not the atlas's eleven.
- Ethiopia's current COD-AB source includes Central Ethiopia, South Ethiopia,
  South West Ethiopia and Sidama, for 12 regions plus Addis Ababa and Dire
  Dawa. The publisher's fifteenth, contested polygon is neutral context.
  Sudan shows 18 states; the source's separate Abyei polygon is neutral
  context and is not assigned the national value.
- Madagascar's COD-AB geometry includes Vatovavy, Fitovinany and Ambatosoa,
  for 24 regions. Some native `valid_on` fields still carry a legacy date;
  that field is retained without representing it as the date of the reforms.
  The full response and normalized feature hashes identify the actual input.
- Tanzania uses the NBS/OCHA 2018 shapefile with Songwe and 31 regions.
  Cambodia uses 25 provinces/capital areas, Laos 18 province-level areas,
  Mauritania 15 regions and Qatar eight municipalities. Sierra Leone uses
  five regions, including North Western. Chad uses 23 provinces and Yemen
  22 governorates, including Socotra.
- Lebanon uses the nine-governorate geometry, including Keserwan-Jbeil.
  Bahrain uses four governorates after the Central Governorate dissolution.
  Saint Lucia uses ten districts. The Bahamas uses 31 districts plus New
  Providence, retained as a distinct geographic area.
- Myanmar's publisher splits Bago east/west and Shan east/north/south.
  The manifest dissolves those pieces into Bago and Shan, producing the
  current seven regions, seven states and Nay Pyi Taw Union Territory.
- Timor-Leste separates the complete Ataúro island polygon from Dili, following
  the [current municipal geography](https://portal.municipio.gov.tl/en/).
  The operation partitions existing whole polygons; it does not draw a new
  boundary from a rectangle. The importer rejects a selection box crossing
  land. Ataúro and Oecusse have separate detached insets. There are 14 areas.
- Afghanistan uses 34 native atlas feature IDs, with `AFG-1772` labelled
  Panjshir and `AFG-1753` Daykundi. Repeated legacy ISO codes and labels are
  not used to merge them into Parwan or Uruzgan. Malawi's `MWI-1194` is
  Karonga, separate from Chitipa. Mozambique keeps Maputo City (`MOZ-5854`)
  and Maputo Province (`MOZ-1927`) separate despite their repeated ISO code.
  Original source fields remain available for audit.
- Trinidad and Tobago dissolves the atlas's eastern and western Tobago
  pieces into one Tobago area alongside 14 Trinidad municipal areas.
  Venezuela joins the unlabelled offshore feature `VEN+99?` to Federal
  Dependencies and uses La Guaira's current name. The map does not add the
  Venezuelan claim over Guyanese territory to the national silhouette.
- China excludes the source's Hong Kong, Macao and Taiwan features. Its 31
  mainland areas coexist with Hong Kong's separate app map. Mainland labels
  correct the source's Guangzhou/Guangdong and repeated Ningxia text.
- Moldova retains 37 first-level geographic areas. Transnistria and Bender
  are neutral detached context. Cyprus shows six districts; Kyrenia and
  the two districts crossing the ceasefire line, Nicosia and Famagusta,
  are neutral context. Neutral presentation does not remove their boundaries
  or name targets, or equate those whole districts with missing observations.
- Pakistan uses the post-2018 seven-area geometry, with the former FATA
  incorporated into Khyber Pakhtunkhwa. Somalia uses the 18 geographic
  regions rather than mistaking the atlas's partial 13-region coverage for
  the whole country. These geographical outlines do not assert control.

### Geographic tiers and island scope

- Uganda's four geographic regions are statistical groupings, not a claim to
  show every district or city council. Togo's five geographic regions are
  distinguished from municipal government and the autonomous Grand Lomé district.
- Kiribati shows the Gilbert, Phoenix and Line island groups, not its island
  councils. The Marshall Islands use 24 local-government island areas rather
  than the atlas's two island chains. Uninhabited atolls outside the supplied
  polygons are not silently assigned to another area.
- Maldives uses its 20 atoll areas and separate Malé geography; city councils
  nested within those atoll areas are not additional overlapping polygons.
  São Tomé and Príncipe shows the two island areas, with no claim that these
  are seven municipal districts. Palestine shows the West Bank and Gaza
  geographic areas, with no claim to provide sixteen governorates. These
  maps use the statistical-geography notice.
- Greenland uses the five municipalities after the 2018 split, plus Northeast
  Greenland National Park as neutral context. Pituffik is not represented as
  an additional municipality. Mauritius uses nine districts, Rodrigues,
  Agaléga and Saint Brandon. Chagos and Tromelin are outside this source set.
- The Channel Islands map uses the current two bailiwick footprints, Jersey
  and Guernsey. Guernsey includes Alderney and Sark, as described by
  [the UK government](https://www.gov.uk/government/publications/deporting-non-eea-foreign-nationals/crown-dependencies-deportation-accessible).
  The atlas incorrectly labels its entire Guernsey footprint Sark; the
  manifest corrects that display name. This aggregate does not show parish
  boundaries or treat the islands as one sovereign country.
- American Samoa separates Rose Atoll and Swains Island into insets. Fiji
  detaches Rotuma, and Micronesia detaches Kosrae, Chuuk and Yap around the
  main Pohnpei frame, with a supplementary outer-island panel. Palau separates
  Hatohobei and Sonsorol; Tonga and French Polynesia place their distant
  divisions in their own panels. Shared PNGs avoid stroking the coast of a
  single-area inset, since that erases narrow islands at card resolution. Other small areas are enlarged without creating a
  duplicate name target. Small-area selection uses polygon geometry, never
  Natural Earth's unpopulated `area_sqkm` field.

### Identifiers, sources and reproduction

Native atlas `adm1_code` values identify the new Natural Earth divisions.
They are release-scoped identifiers, not invented current ISO codes. Names,
joins and source-country membership are explicit in `countries.ts`. The
Channel Islands aggregate selects only the GGY/JEY source features; other
maps still reject foreign source-country features. The pinned atlas response
hash and each map's expected code set continue to be checked.

The external sources use the existing Schema-decoded, hash-pinned boundary
manifest and snapshots. `omit` excludes declared source features, including
China's three separately scoped areas. `islands` partitions complete polygons
for Ataúro, while `joins` dissolves source pieces. Context codes participate
in the expected-source audit but do not receive national shading. All member
attributes are retained. Normal generation remains offline.

geoBoundaries reports source-specific licences, not one global licence.
The manifest preserves the selected release URL, source year and licence.
The new OCHA COD-AB inputs are CC BY-IGO. Several geoBoundaries inputs derive
from OpenStreetMap and retain ODbL attribution. Greenland's source is CC BY-SA
3.0; its adapted boundary data retains that licence. Public-domain and CC BY
sources retain their respective terms. Software remains under its own licence.
Share-alike sources have downloadable archives containing selected source
features, projected display geometry and attribution, under the source licence.
They are fetched only if the reader chooses the download link.

All 100 maps have light/dark stories. The maps package checks each country's
named areas and exact area count through its public loader. Web integration
tests check shared hover and keyboard behavior, attribution and scope distinctions.
National legends, data tables, observation attribution and comparison frames
remain unchanged.

## Final candidate audit

The final candidate slice adds 27 maps, bringing coverage to 212 of 217 app
entries. Five candidates remain on the existing fallback because current,
reusable geometry has not been verified. [The audit](final-candidates.md) lists
every added tier, the unresolved candidates, reform checks, licences and
reproduction details. A fallback is not counted as a completed detailed map.
