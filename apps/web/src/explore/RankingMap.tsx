import { type Country, countries, regionOf, type ResolvedView } from "@repo/domain"
import {
  type Area,
  banded,
  type Band,
  type BoundaryCredit,
  load,
  offMap,
  path,
  shades,
  type Sheet,
} from "@repo/maps"
import { use, useId } from "react"
import { useTranslation } from "react-i18next"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { shading } from "./palette.ts"
import { useFormat } from "./useFormat.ts"

interface AreasProps {
  areas: ReadonlyArray<Area>
}

// Names on the main map and insets share pointer and keyboard behaviour.
const Areas = ({ areas }: AreasProps) =>
  areas.map((area) => (
    <TooltipTrigger
      key={area.code}
      payload={area.name}
      render={
        <path
          // An SVG path needs a role to expose the named area to assistive technology.
          // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="img"
          aria-label={area.name}
          tabIndex={0}
          d={path(area.outline)}
          fill="transparent"
          className="stroke-background focus:stroke-foreground focus:outline-none"
          strokeWidth={1.5}
        />
      }
    />
  ))

const ONSNote = () => {
  const { t } = useTranslation("explore")

  return (
    <p className="text-sm text-muted-foreground">
      {t(
        ($) =>
          $[
            "UK boundaries show 12 statistical regions: nine English regions, Scotland, Wales and Northern Ireland. Colour shows the national value."
          ],
      )}{" "}
      {t(($) => $["Insets use different scales."])}{" "}
      <a
        href="https://ckan.publishing.service.gov.uk/dataset/international-territorial-level-1-january-2025-boundaries-uk-buc"
        className="underline underline-offset-4"
      >
        {t(($) => $["Boundaries: Office for National Statistics, January 2025."])}
      </a>{" "}
      <a
        href="https://www.ons.gov.uk/methodology/geography/licences/"
        className="underline underline-offset-4"
      >
        {t(
          ($) =>
            $[
              "Source: Office for National Statistics licensed under the Open Government Licence v.3.0"
            ],
        )}
      </a>{" "}
      {t(($) => $["Contains OS data © Crown copyright and database right 2025"])}
    </p>
  )
}

const TailteNote = () => {
  const { t } = useTranslation("explore")

  return (
    <p className="text-sm text-muted-foreground">
      {t(($) => $["Borders show regions. Colour shows the national value, not regional values."])}{" "}
      {t(($) => $["Shows 31 local authority areas."])} {t(($) => $["Insets use different scales."])}{" "}
      <a
        href="https://www.arcgis.com/home/item.html?id=ed592af6f0444bf1b0becdb5925f9477"
        className="underline underline-offset-4"
      >
        {t(($) => $["Boundaries: © Tailte Éireann, 2024."])}
      </a>{" "}
      <a
        href="https://creativecommons.org/licenses/by/4.0/"
        className="underline underline-offset-4"
      >
        {t(($) => $["CC BY 4.0. Simplified for display."])}
      </a>
    </p>
  )
}

const LandBoardNote = () => {
  const { t } = useTranslation("explore")

  return (
    <p className="text-sm text-muted-foreground">
      {t(($) => $["Borders show regions. Colour shows the national value, not regional values."])}{" "}
      {t(($) => $["Shows 15 counties."])} {t(($) => $["Insets use different scales."])}{" "}
      <a
        href="https://geoportaal.maaruum.ee/eng/spatial-data/administrative-and-settlement-division-p312.html"
        className="underline underline-offset-4"
      >
        {t(($) => $["Boundaries: Estonian Land and Spatial Development Board, 12 November 2026."])}
      </a>
    </p>
  )
}

interface NaturalEarthNoteProps {
  sheet: Sheet
}

const NaturalEarthNote = ({ sheet }: NaturalEarthNoteProps) => {
  const { t } = useTranslation("explore")
  const country = sheet.subdivisions?.country

  return (
    <p className="text-sm text-muted-foreground">
      {t(($) => $["Borders show regions. Colour shows the national value, not regional values."])}{" "}
      {sheet.insets.length === 0 ? null : <>{t(($) => $["Insets use different scales."])} </>}
      {country === "GRC" ? (
        <>{t(($) => $["Shows 13 regions and the self-governed territory of Mount Athos."])} </>
      ) : null}
      {country === "USA" ? (
        <>{t(($) => $["Shows the 50 states and Washington, DC. US territories are not shown."])} </>
      ) : null}
      {country === "AUS" ? (
        <>
          {t(
            ($) =>
              $[
                "Shows six states, the Northern Territory, the Australian Capital Territory and Jervis Bay. External territories are not shown."
              ],
          )}{" "}
        </>
      ) : null}
      {country === "NLD" ? (
        <>
          {t(
            ($) =>
              $[
                "Caribbean municipalities are shown for location only; the national value is not applied to them."
              ],
          )}{" "}
        </>
      ) : null}
      {country === "NZL" ? (
        <>
          {t(
            ($) =>
              $[
                "Shows 16 regions and the Chatham Islands. Outlying island groups are context only. The Cook Islands, Niue and Tokelau are not included."
              ],
          )}{" "}
        </>
      ) : null}
      <a
        href="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/"
        className="underline underline-offset-4"
      >
        {t(($) => $["Boundaries: Natural Earth, Admin 1, v5.1.2."])}
      </a>
    </p>
  )
}

interface BoundaryNoteProps {
  country: Country
  credit: BoundaryCredit
  insets: boolean
}

const BoundaryNote = ({ country, credit, insets }: BoundaryNoteProps) => {
  const { t } = useTranslation("explore")

  return (
    <p className="text-sm text-muted-foreground">
      {t(($) => $["Borders show regions. Colour shows the national value, not regional values."])}{" "}
      {credit.kind === "Statistical" ? <>{t(($) => $["Statistical regions"])}. </> : null}
      {credit.kind === "Geographic" ? <>{t(($) => $["Geographic areas"])}. </> : null}
      {insets ? <>{t(($) => $["Insets use different scales."])} </> : null}
      <a href={credit.url} className="underline underline-offset-4">
        {t(($) => $["Boundaries: {{publisher}}, {{vintage}}."], {
          publisher: credit.publisher,
          vintage: credit.vintage,
        })}
      </a>{" "}
      <a href={credit.licenseUrl} className="underline underline-offset-4">
        {t(($) => $["{{license}}. Adapted for display."], { license: credit.license })}
      </a>
      {credit.license.startsWith("ODbL") || credit.license.startsWith("CC BY-SA") ? (
        <>
          {" "}
          <a href={`/boundaries/${country}.zip`} download className="underline underline-offset-4">
            {t(($) => $["Download boundary data"])}
          </a>
        </>
      ) : null}
    </p>
  )
}

interface ScopeNoteProps {
  country: Country
}

const ScopeNote = ({ country }: ScopeNoteProps) => {
  const { t } = useTranslation("explore")

  const notes: Partial<Record<Country, string>> = {
    BWA: t(
      ($) =>
        $[
          "Shows ten districts and six urban areas. These geographic areas differ from the 31 local councils."
        ],
    ),
    CUW: t(
      ($) =>
        $[
          "Shows 61 census-viewer geozones. Land outside those polygons is shown for location only."
        ],
    ),
    FRO: t(($) => $["Shows six geographic regions."]),
    MAF: t(
      ($) =>
        $["Shows 14 statistical neighbourhoods, distinct from the six neighbourhood councils."],
    ),
    MAC: t(($) => $["Shows seven parishes and Cotai as statistical areas."]),
    MCO: t(
      ($) => $["Shows nine planning areas, including Monaco-Ville and Ravin Sainte-D\u00e9vote."],
    ),
    SSD: t(
      ($) => $["Shows ten states and two administrative areas. Abyei is shown for location only."],
    ),
    SYC: t(($) => $["Shows 26 districts. The Outer Islands are shown for location only."]),
    UKR: t(
      ($) =>
        $[
          "Borders show internationally recognized administrative areas, not territorial control. National data may cover a different territory."
        ],
    ),
    MAR: t(
      ($) => $["Western Sahara is shown for location only; the national value is not applied."],
    ),
    VGB: t(($) => $["Shows five island groups rather than electoral districts."]),
    TKM: t(($) => $["Shows five provinces and the independent cities of Ashgabat and Arkadag."]),
    RUS: t(
      ($) =>
        $[
          "Borders show internationally recognized administrative areas, not territorial control. National data may cover a different territory."
        ],
    ),
    ISL: t(($) => $["Shows eight statistical regions."]),
    NOR: t(($) => $["Shows 15 mainland counties. Svalbard and Jan Mayen are not included."]),
    PHL: t(
      ($) =>
        $["Shows 82 provinces, 38 independent cities, Pateros and the Special Geographic Area."],
    ),
    GEO: t(
      ($) =>
        $[
          "Borders show geography, not statistical coverage or territorial control. National data may exclude Abkhazia and South Ossetia."
        ],
    ),
    DZA: t(
      ($) =>
        $[
          "Shows 69 wilayas under the 2026 law. Transfer of powers continues through December 2026."
        ],
    ),
    KOR: t(($) => $["Shows 16 first-level units after the July 2026 Jeonnam-Gwangju merger."]),
  }

  const note = notes[country]

  return note === undefined ? null : <p className="text-sm text-muted-foreground">{note}</p>
}

interface SourceNoteProps {
  sheet: Sheet
}

// Each publisher's scope and boundary attribution stay beside its country maps.
const SourceNote = ({ sheet }: SourceNoteProps) => {
  const { subdivisions } = sheet

  if (subdivisions === undefined) return null

  if (subdivisions.source === "Boundary")
    return (
      <BoundaryNote
        country={subdivisions.country}
        credit={subdivisions.credit}
        insets={sheet.insets.length > 0}
      />
    )

  if (subdivisions.source === "ONS") return <ONSNote />

  if (subdivisions.source === "Tailte") return <TailteNote />

  if (subdivisions.source === "LandBoard") return <LandBoardNote />

  return <NaturalEarthNote sheet={sheet} />
}

interface MapNoteProps {
  sheet: Sheet
}

const MapNote = ({ sheet }: MapNoteProps) =>
  sheet.subdivisions === undefined ? null : (
    <>
      <SourceNote sheet={sheet} />
      <ScopeNote country={sheet.subdivisions.country} />
    </>
  )

interface RankingMapProps {
  // One year's values.
  resolved: ResolvedView
  // The shades of a map over time, fixed across its span.
  bands?: ReadonlyArray<Band> | undefined
}

// A map shaded by rank, or for a map over time by value on bands fixed across
// its span, with a key of each shade's values. A supported country gets its
// own map; comparisons use the first region holding every country, else the
// world. An indicator with a direction
// shades from green for better to red for worse, and its key says which way
// is better. It suspends while that map's outlines load. A country without a
// value, or not asked for, stays blank; the land around a region is fainter
// still. A note names the countries too small to draw; the data table lists
// every value.
export const RankingMap = ({ resolved, bands }: RankingMapProps) => {
  const { phrase } = useFormat()

  const { formatValue, countryName, formatCompact } = useFormat()

  const { t } = useTranslation("explore")

  const caption = useId()
  const region = regionOf(resolved.view.countries)
  const sheet = use(load(resolved.view.countries))

  const { byCountry, key } =
    bands === undefined
      ? shades(resolved.observations)
      : { byCountry: banded(resolved.observations, bands), key: bands }

  const paint = shading(resolved.direction)
  const better = phrase(resolved.direction)

  const values = new Map(resolved.observations.map((each) => [each.country, each.value]))

  const hidden = offMap(
    sheet,
    resolved.observations.map((each) => each.country),
  )

  const fillOf = (country: Country) => {
    const shade = byCountry.get(country)

    return shade === undefined ? "var(--border)" : paint(shade)
  }

  const valueOf = (country: Country) => {
    const value = values.get(country)

    return value === undefined ? t(($) => $["No data"]) : formatValue(value)
  }

  return (
    <figure className="flex flex-col gap-3" aria-labelledby={caption}>
      <figcaption id={caption} className="sr-only">
        {t(($) => $["{{value1}} {{value2}} countries by {{value3}}{{value4}}"], {
          value1:
            sheet.subdivisions !== undefined
              ? t(($) => $["Map of {{region}}"], {
                  region: countryName(sheet.subdivisions.country),
                })
              : region === undefined
                ? t(($) => $["World map"])
                : t(($) => $["Map of {{region}}"], { region: region.name }),
          value2: bands === undefined ? t(($) => $["ranking"]) : t(($) => $["shading"]),
          value3: resolved.title,
          value4: better === undefined ? "" : `, ${better.toLowerCase()}`,
        })}
      </figcaption>
      {/* One tooltip, opened by whichever shape the pointer rests on and
          following it, shows that shape's label: its country and value. */}
      <Tooltip<string> trackCursorAxis="both">
        {({ payload }) => (
          <>
            <svg
              viewBox={`0 0 ${sheet.width} ${sheet.height}`}
              className="h-auto max-h-[70svh] w-full"
              aria-hidden={sheet.subdivisions === undefined ? true : undefined}
              role={sheet.subdivisions === undefined ? undefined : "group"}
              aria-label={
                sheet.subdivisions === undefined
                  ? undefined
                  : countryName(sheet.subdivisions.country)
              }
            >
              <path d={path(sheet.land)} className="fill-muted/60" />
              {countries.flatMap(({ code }) => {
                const outline = sheet.outlines[code]
                const label = `${countryName(code)}: ${valueOf(code)}`

                return outline === undefined
                  ? []
                  : [
                      <TooltipTrigger
                        key={code}
                        payload={label}
                        render={
                          <path
                            aria-label={label}
                            d={path(outline)}
                            className="stroke-background motion-safe:transition-[fill] motion-safe:duration-500"
                            fill={fillOf(code)}
                            strokeWidth={0.5}
                          />
                        }
                      />,
                    ]
              })}
              <Areas areas={sheet.subdivisions?.areas ?? []} />
            </svg>
            {sheet.insets.length > 0 ? (
              <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {sheet.insets.map((inset) => {
                  const value =
                    inset.coverage === "Context"
                      ? t(($) => $["Location only; national value not applied."])
                      : valueOf(inset.country)

                  const label = `${inset.name}, ${countryName(inset.country)}: ${value}`

                  return (
                    <li
                      key={inset.name}
                      className="flex flex-col gap-1 text-xs text-muted-foreground"
                    >
                      <svg
                        viewBox={`0 0 ${inset.width} ${inset.height}`}
                        className="h-auto w-full rounded-sm border"
                        aria-hidden={inset.areas === undefined ? true : undefined}
                        role={inset.areas === undefined ? undefined : "group"}
                        aria-label={inset.areas === undefined ? undefined : inset.name}
                      >
                        <TooltipTrigger
                          payload={label}
                          render={
                            <path
                              aria-label={label}
                              d={path(inset.outline)}
                              stroke={
                                inset.areas === undefined && sheet.subdivisions !== undefined
                                  ? "var(--border)"
                                  : undefined
                              }
                              strokeWidth={1.5}
                              fill={
                                inset.coverage === "Context"
                                  ? "var(--border)"
                                  : fillOf(inset.country)
                              }
                            />
                          }
                        />
                        <Areas areas={inset.areas ?? []} />
                      </svg>
                      {inset.name}
                    </li>
                  )
                })}
              </ul>
            ) : null}
            <TooltipContent>{payload}</TooltipContent>
          </>
        )}
      </Tooltip>
      <MapNote sheet={sheet} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {better === undefined ? null : <li className="text-foreground">{better}</li>}
        {key.map(({ shade, low, high }) => (
          <li key={shade} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: paint(shade) }} aria-hidden />
            {low === high ? formatCompact(low) : `${formatCompact(low)}–${formatCompact(high)}`}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-border" aria-hidden />
          {t(($) => $["No data"])}
        </li>
      </ul>
      {hidden.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(($) => $["Too small to show on this map: {{value}}."], {
            value: hidden.map(countryName).join(", "),
          })}
        </p>
      ) : null}
    </figure>
  )
}
