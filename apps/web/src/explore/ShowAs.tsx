import { applies, kindOf, type Transform, transformOf, type View } from "@civicdata/domain"
import { Match } from "effect"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { ratioFor, withTransform } from "./edits.ts"

const choices = [
  { value: "Values", label: "Values" },
  { value: "PerPerson", label: "Per person" },
  { value: "Growth", label: "Growth" },
  { value: "Index", label: "Index" },
  { value: "Ratio", label: "Ratio" },
] as const

type Choice = (typeof choices)[number]["value"]

// The transform a choice stands for. A ratio first divides by GDP.
const transformFor = (choice: Choice, view: View): Transform | undefined =>
  Match.value(choice).pipe(
    Match.when("Values", () => undefined),
    Match.when("Ratio", () => ratioFor(view.indicator)),
    Match.orElse((plain) => plain),
  )

interface ShowAsProps {
  view: View
  // The indicator's name once loaded; until then every transform is offered.
  name: string | undefined
  onChange: (view: View) => void
}

// What the chart shows: the indicator's values, or a transform of them. A
// transform the indicator cannot take is disabled. A chart type offers only
// the transforms it takes, and a relation none, so it shows no choice.
export const ShowAs = ({ view, name, onChange }: ShowAsProps) => {
  const offered = Match.valueTags(view, {
    Trend: () => choices,
    Ranking: () => choices.filter((choice) => choice.value !== "Index"),
    Change: () =>
      choices.filter((choice) => ["Values", "PerPerson", "Ratio"].includes(choice.value)),
    Relation: () => [],
  })

  if (offered.length === 0) return null

  const transform = transformOf(view)

  return (
    <ToggleGroup
      aria-label="Show as"
      variant="outline"
      value={[transform === undefined ? "Values" : kindOf(transform)]}
      onValueChange={(next: Array<string>) => {
        const picked = offered.find((choice) => next.includes(choice.value))

        if (picked !== undefined) onChange(withTransform(view, transformFor(picked.value, view)))
      }}
    >
      {offered.map((choice) => {
        const shows = transformFor(choice.value, view)

        return (
          <ToggleGroupItem
            key={choice.value}
            value={choice.value}
            disabled={shows !== undefined && name !== undefined && !applies(shows, name)}
          >
            {choice.label}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
