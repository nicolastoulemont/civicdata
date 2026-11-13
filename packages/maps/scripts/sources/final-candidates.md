# Final candidate audit

Audited on 13 November 2026. This slice adds 27 maps, bringing the registry to
212 of the app's 217 country/economy entries. Five candidates remain on the
existing comparison-map fallback. They are not counted as detailed maps.

The acceptance rules are current boundaries and commercial reuse rights. A recent download date does not
make an older administrative arrangement current. Statistical and geographic
areas are labelled separately from administrative divisions. Colours and
observations remain national.

## Accepted maps

Most additions use the pinned Overture `2026-10-21.0` divisions release. Angola
uses the World Bank's current 21-province release. Saint Martin uses IGN/Insee
statistical neighbourhoods and IGN Admin Express for Tintamarre. Curaçao uses
its statistical office's Census 2023 viewer, pinned to a Git commit.
The manifest records the exact requests, selections, licences and hashes.

| Country/economy            | Areas | Displayed tier                                                                                                       |
| -------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------- |
| Angola                     |    21 | current provinces, including Cuando, Cubango, Icolo e Bengo and Moxico Leste                                         |
| Azerbaijan                 |    78 | 67 districts and 11 cities; no overlapping Nakhchivan parent or Baku child                                           |
| Botswana                   |    16 | ten districts and six urban areas, distinguished from 31 local councils                                              |
| Cayman Islands             |     6 | traditional districts, including the Sister Islands                                                                  |
| Curaçao                    |    61 | census-viewer geozones; land outside its polygons and Klein Curaçao are neutral context                              |
| Equatorial Guinea          |     8 | provinces, including Djibloho                                                                                        |
| Faroe Islands              |     6 | geographic regions, distinguished from municipalities                                                                |
| Guam                       |    19 | village municipalities                                                                                               |
| Iraq                       |    19 | governorates, including Halabja                                                                                      |
| Isle of Man                |    21 | local authorities after the Garff and Arbory/Rushen mergers                                                          |
| Kosovo                     |    38 | municipalities                                                                                                       |
| Macao                      |     8 | seven parishes and Cotai, labelled statistical areas                                                                 |
| Monaco                     |     9 | planning areas, including Monaco-Ville and Ravin Sainte-Dévote                                                       |
| Montenegro                 |    25 | municipalities, including Tuzi and Zeta                                                                              |
| Morocco                    |    11 | region portions outside Western Sahara; Western Sahara is separate neutral context                                   |
| Northern Mariana Islands   |     4 | municipalities                                                                                                       |
| North Korea                |    13 | nine provinces and four directly governed/special cities                                                             |
| Panama                     |    14 | ten provinces and four province-level comarcas, including Naso Tjër Di                                               |
| Puerto Rico                |    78 | municipalities                                                                                                       |
| Russia                     |    83 | internationally recognized federal subjects, excluding annexation claims                                             |
| Saint Martin (French part) |    14 | current IRIS statistical neighbourhoods, distinct from the six neighbourhood councils; Tintamarre is neutral context |
| Seychelles                 |    26 | districts, joining the two Île Persévérance administration areas                                                     |
| South Sudan                |    12 | ten states plus Ruweng and Greater Pibor; Abyei PCA is neutral context                                               |
| Turkmenistan               |     7 | five provinces plus Ashgabat and Arkadag                                                                             |
| Tuvalu                     |     8 | island council areas; Niulakita has a separate location inset within Niutao's area                                   |
| Ukraine                    |    27 | 24 oblasts, Crimea, Kyiv and Sevastopol, irrespective of territorial control                                         |
| British Virgin Islands     |     5 | island groups, distinguished from electoral districts                                                                |

Selected checks against primary sources:

- [Angola's current provinces](https://governo.gov.ao/angola/provincias)
  and [World Bank official boundaries](https://datacatalog.worldbank.org/search/dataset/0038272/world-bank-official-boundaries).
  The 21 source polygons form a non-overlapping partition; the retired Cuando
  Cubango unit is absent.
- [IGN/Insee Contours IRIS](https://www.data.gouv.fr/datasets/contours-iris-r-2)
  supplies 14 Saint Martin neighbourhoods, not the former eight or the six
  neighbourhood councils. [IGN Admin Express](https://geoservices.ign.fr/adminexpress)
  supplies Tintamarre's national-outline geometry. Both use
  [Open Licence 2.0](https://github.com/etalab/licence-ouverte/blob/master/LO.md).

- [Iraq's Halabja law, official gazette](https://www.moj.gov.iq/view.9251/)
  and [Montenegro's 25 municipalities](https://rr-europe.woah.org/app/uploads/2024/04/report_sge-asf_montenegro.pdf).
- [Isle of Man's current local authorities](https://www.gov.im/categories/home-and-neighbourhood/local-authorities/local-authority-contacts/)
  and the [Garff merger](https://www.gov.im/categories/home-and-neighbourhood/local-authorities/local-authority-contacts/garff/).
- [Statistics Botswana's ten-district grouping](https://www.statsbots.org.bw/sites/default/files/publications/Botswana%20Population%20%26%20Housing%20Census%202022%20Analytical%20Report%20Volume%205%20Fertility%2C%20Mortality%20and%20Household%20Energy%20Use.pdf),
  distinct from the [31 local councils](https://gov.bw/ministries/ministry-local-government-and-traditional-affairs).
- [Seychelles' 26 districts and 27 administration offices](https://localgovernment.gov.sc/)
  and [Île Persévérance's two villages](https://www.localgovernment.gov.sc/district-profiles/ile-perseverance-one).
- [Arkadag's independent status](https://turkmenistan.gov.tm/en/post/71147/president-turkmenistan-signed-decree-renaming-hakimlik-city-arkadag)
  and [the March 2025 territory change](https://bilim.tm/en/news/2914).
  The release supplies the July 2026 OSM boundary record for Arkadag. The map
  promotes that city out of the source's county classification and subtracts
  its sourced geometry from Ahal and Ashgabat, avoiding overlapping areas.
- [Curaçao's official viewer](https://www.cbs.cw/geozone-and-neighborhood-information-census-2023)
  and [its attribution terms](https://www.cbs.cw/disclaimer).

## Candidates still blocked

| Candidate          | Evidence and required next input                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Aruba              | CBS supplies the eight-region GAC geometry, but its FAQ restricts use without authorization to noncommercial purposes. The layer supplies no broader licence. Commercial reuse is required. Need explicit commercial reuse permission or another current source that allows commercial reuse.                                                                |
| Congo, Republic of | The October 2024 laws create 15 departments and alter Brazzaville and other parent territories. COD-AB, geoBoundaries and the World Bank candidate still have 12 departments. The older 89-district mesh lacks Bokoma, Kintélé and other changed units, so a simple regrouping cannot establish current boundaries. Need verified new department geometry.   |
| Gibraltar          | The official viewer exposes map layers, but the WFS request returned HTTP 403. No reusable current residential-area polygon release was verified. Need current census/residential-area polygons and reuse terms; do not invent an administrative tier.                                                                                                       |
| Libya              | The ministry lists 117 municipalities. The candidate atlas/divisions layers describe older district arrangements or an incomplete municipality set. Need a complete current municipal release, with its geography reconciled to the ministry's list.                                                                                                         |
| Sint Maarten       | The licensed COD-AB source has eight areas but dates its geometry to 2018. Its footprint overlaps the current IGN Saint Martin mesh. The 2023 treaty registry supplies no entry-into-force date, so signature alone is not treated as a completed boundary change. Need the country edge and district coverage reconciled to authoritative current geometry. |

Evidence links:

- [Aruba's reuse terms](https://cbs.aw/wp/index.php/questions/) and
  [current GAC publication](https://cbs.aw/wp/index.php/2025/01/14/gac-geographical-address-classification-2025/).
- [Congo's October 2024 laws](https://www.sgg.cg/JO/2024/congo-jo-2024-42.pdf).
- [Gibraltar's official viewer](https://viewers.geoportal.gov.gi/).
- [Libya's ministry municipality list](https://www.lgm.gov.ly/municipalities).
- [Saint Martin COD-AB](https://data.humdata.org/dataset/cod-ab-maf),
  [Sint Maarten COD-AB](https://data.humdata.org/dataset/cod-ab-sxm),
  [2023 border treaty](https://zoek.officielebekendmakingen.nl/trb-2023-66.html),
  [treaty status registry](https://verdragenbank.overheid.nl/en/Treaty/Details/013951.html),
  [government's treaty line](https://gis.sintmaartengov.org/arcgis/rest/services/Landborder_SintMaarten_SaintMartin/MapServer/0).

## Reproduction and attribution

`pnpm --filter @repo/maps run generate` restores pinned R2 snapshots into the
ignored `.archive/sources` cache, then reads those files offline. Builds and tests
do not restore snapshots. Archive pinning, publication and verification are
documented in the [package guide](../../README.md).
`--pin-boundaries` fetches countries with pending input hashes; `--refresh-lands`
checks every live source against its pinned content. Format after generation.

Overture imports use the development-only DuckDB dependency and its HTTP/spatial
extensions. The World Bank importer uses the same database lifecycle, binds
its URL and ISO country selector, and retains all eight native attribute columns.
Values, including S3 URLs and geographic selectors, are bound SQL parameters.
Each extracted feature retains native IDs, source records, source
licences and update dates. Snapshot inputs also retain the exact selector.
For these parquet extracts, `sha256` hashes the extracted GeoJSON response;
`hash` pins the decoded features. It is not a hash of the entire global parquet
release. Other HTTP inputs retain their full downloaded-response hash. Named insets
are rejected if their projected rings collapse to lines.

Some Overture division polygons marked `is_land` still include coastal water.
Guam, Northern Mariana Islands and Tuvalu therefore retain a second, pinned
input from the same release's physical-land layer. An intersection removes
water while preserving administrative borders. Overlapping coastline tiles
are unioned before intersection, so shared edges do not remove land. The land mask is retained in
the source download but is not a named administrative area.

Curaçao's importer reads the publisher's Leaflet polygons and accompanying
neighbourhood-to-geozone table. It rejects missing or ambiguous membership and
unpaired coordinates, and removes one identical repeated neighbourhood polygon.
The resulting 314 neighbourhood polygons dissolve to 61 geozones. The viewer
does not cover all land. Remaining land comes from the pinned Overture national
outline and stays neutral on the main map, with Klein Curaçao in a separate inset.
We do not infer missing geozone boundaries or apply national values to the context.

`cuts` subtracts declared sourced polygons, such as Arkadag or Western Sahara,
without creating a boundary line. Original geometry remains in the snapshot.
Context areas have no national value applied. These maps show recognized
administrative geography and do not describe territorial control or prove the
territorial coverage of an observation.

Overture's [attribution page](https://docs.overturemaps.org/attribution/) and each
feature's native source records identify the upstream contributors. Credits
include OpenStreetMap, Esri Community Maps, Maps Entity Variant Names and OCHA
where their records contribute. Mixed licences stay explicit. Every ODbL map
has a generated `/boundaries/{ISO3}.zip` download containing the snapshot,
projected display database and licence notice. Curaçao retains the CBS
attribution terms for census geometry and ODbL for its supplementary outline.
Its download includes both terms.
