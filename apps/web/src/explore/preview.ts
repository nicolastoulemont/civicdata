import type { IndicatorId, View } from "@civicdata/domain"
import { Match } from "effect"

import { countryName, period, subject, transformLabel } from "./format.ts"

const list = new Intl.ListFormat("en", { type: "conjunction" })

// The first three countries, then a count: "France, Germany, Italy, and 4 more".
export const places = (view: View) => {
  const names = view.countries.map(countryName)

  return list.format(names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names)
}

// What a shared link shows before it is opened: the page title and the
// description in a link preview. Names come from the World Bank, never from
// the link, so a crafted URL cannot put words in a preview. Without an
// indicator's name the title falls back to its code.
export const preview = (view: View, names: ReadonlyMap<IndicatorId, string>) => {
  const label = transformLabel(view)

  const verb = Match.valueTags(view, {
    Trend: () => "Compares",
    Ranking: () => "Ranks",
    Change: () => "Compares",
    Relation: () => "Plots",
  })

  return {
    title: `${subject(view, names)} · ${period(view)}`,
    description: `${verb} ${places(view)}${label === undefined ? "" : ` (${label})`}. Source: World Bank.`,
  }
}
