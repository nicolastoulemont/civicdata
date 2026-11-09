import { countries, type ResolvedView } from "@civicdata/domain"

import { countryName, formatCompact, formatValue } from "./format.ts"
import { height, offMap, path, shades, width } from "./world.ts"

// The theme's chart colours, lightest for the lowest values.
const fills = ["fill-chart-1", "fill-chart-2", "fill-chart-3", "fill-chart-4", "fill-chart-5"]
const swatches = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"]

// A world map shaded by rank, with a key of each shade's values. A country
// without a value, or not asked for, stays blank. A note names the countries
// too small to draw; the data table lists every value.
export const RankingMap = ({ resolved }: { resolved: ResolvedView }) => {
  const { byCountry, key } = shades(resolved.observations)
  const values = new Map(resolved.observations.map((each) => [each.country, each.value]))
  const hidden = offMap(resolved.observations.map((each) => each.country))

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">{`World map ranking countries by ${resolved.title}`}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" aria-hidden>
        {countries.flatMap(({ code }) => {
          const outline = path(code)
          const shade = byCountry.get(code)
          const value = values.get(code)

          return outline === ""
            ? []
            : [
                <path
                  key={code}
                  d={outline}
                  className={`${shade === undefined ? "fill-border" : fills[shade]} stroke-background`}
                  strokeWidth={0.5}
                >
                  <title>
                    {value === undefined
                      ? `${countryName(code)}: no data`
                      : `${countryName(code)}: ${formatValue(value)}`}
                  </title>
                </path>,
              ]
        })}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {key.map(({ shade, low, high }) => (
          <li key={shade} className="flex items-center gap-1.5">
            <span className={`size-3 rounded-sm ${swatches[shade] ?? ""}`} aria-hidden />
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
