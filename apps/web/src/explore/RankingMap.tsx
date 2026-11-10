import { type Country, countries, regionOf, type ResolvedView } from "@civicdata/domain"
import { use, useId } from "react"

import { countryName, formatCompact, formatValue } from "./format.ts"
import { blend } from "./palette.ts"
import { load, offMap, path, shades } from "./sheet.ts"

interface RankingMapProps {
  resolved: ResolvedView
}

// A map shaded by rank, with a key of each shade's values: of the first
// region holding every country asked for, else of the world. It suspends
// while that map's outlines load. A country without a value, or not asked
// for, stays blank; the land around a region is fainter still. A note names
// the countries too small to draw; the data table lists every value.
export const RankingMap = ({ resolved }: RankingMapProps) => {
  const caption = useId()
  const region = regionOf(resolved.view.countries)
  const sheet = use(load(region))
  const { byCountry, key } = shades(resolved.observations)
  const values = new Map(resolved.observations.map((each) => [each.country, each.value]))

  const hidden = offMap(
    sheet,
    resolved.observations.map((each) => each.country),
  )

  const fillOf = (country: Country) => {
    const shade = byCountry.get(country)

    return shade === undefined ? "var(--border)" : blend(shade)
  }

  const valueOf = (country: Country) => {
    const value = values.get(country)

    return value === undefined ? "no data" : formatValue(value)
  }

  return (
    <figure className="flex flex-col gap-3" aria-labelledby={caption}>
      <figcaption
        id={caption}
        className="sr-only"
      >{`${region === undefined ? "World map" : `Map of ${region.name}`} ranking countries by ${resolved.title}`}</figcaption>
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
                  className="stroke-background"
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
        {key.map(({ shade, low, high }) => (
          <li key={shade} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: blend(shade) }} aria-hidden />
            {low === high ? formatCompact(low) : `${formatCompact(low)}–${formatCompact(high)}`}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-border" aria-hidden />
          No data
        </li>
      </ul>
      {hidden.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Too small to show on this map: {hidden.map(countryName).join(", ")}.
        </p>
      ) : null}
    </figure>
  )
}
