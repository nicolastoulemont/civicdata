import { type Country, countries, regionOf, type ResolvedView } from "@openfacts/domain"
import { use, useId } from "react"
import { useTranslation } from "react-i18next"

import { shading } from "./palette.ts"
import { banded, type Band, load, offMap, path, shades } from "./sheet.ts"
import { useFormat } from "./useFormat.ts"

interface RankingMapProps {
  // One year's values.
  resolved: ResolvedView
  // The shades of a map over time, fixed across its span.
  bands?: ReadonlyArray<Band> | undefined
}

// A map shaded by rank, or for a map over time by value on bands fixed across
// its span, with a key of each shade's values: of the first region holding
// every country asked for, else of the world. An indicator with a direction
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
  const sheet = use(load(region))

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
            region === undefined
              ? t(($) => $["World map"])
              : t(($) => $["Map of {{region}}"], { region: region.name }),
          value2: bands === undefined ? t(($) => $["ranking"]) : t(($) => $["shading"]),
          value3: resolved.title,
          value4: better === undefined ? "" : `, ${better.toLowerCase()}`,
        })}
      </figcaption>
      <svg
        viewBox={`0 0 ${sheet.width} ${sheet.height}`}
        className="h-auto max-h-[70svh] w-full"
        aria-hidden
      >
        <path d={path(sheet.land)} className="fill-muted/60" />
        {countries.flatMap(({ code }) => {
          const outline = sheet.outlines[code]

          return outline === undefined
            ? []
            : [
                <path
                  key={code}
                  d={path(outline)}
                  className="stroke-background motion-safe:transition-[fill] motion-safe:duration-500"
                  fill={fillOf(code)}
                  strokeWidth={0.5}
                >
                  <title>{`${countryName(code)}: ${valueOf(code)}`}</title>
                </path>,
              ]
        })}
      </svg>
      {sheet.insets.length > 0 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {sheet.insets.map((inset) => (
            <li key={inset.name} className="flex flex-col gap-1 text-xs text-muted-foreground">
              <svg
                viewBox={`0 0 ${inset.width} ${inset.height}`}
                className="h-auto w-full rounded-sm border"
                aria-hidden
              >
                <path d={path(inset.outline)} fill={fillOf(inset.country)}>
                  <title>{`${inset.name}, ${countryName(inset.country)}: ${valueOf(inset.country)}`}</title>
                </path>
              </svg>
              {inset.name}
            </li>
          ))}
        </ul>
      ) : null}
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
