import { Array as Arr } from "effect"

import { type Place, Verdict } from "../Store.types.ts"

const placeOf = ({ country, year }: Place) => `${country}:${year}`

export const judge = (stored: ReadonlyArray<Place>, candidate: ReadonlyArray<Place>): Verdict => {
  const kept = new Set(candidate.map(placeOf))

  const lost = stored.flatMap(({ country, year }) =>
    kept.has(placeOf({ country, year })) ? [] : [{ country, year }],
  )

  if (!Arr.isReadonlyArrayNonEmpty(candidate)) return Verdict.Hold({ reason: "Empty", lost })

  return Arr.isArrayNonEmpty(lost) ? Verdict.Hold({ reason: "Lost", lost }) : Verdict.Replace()
}
