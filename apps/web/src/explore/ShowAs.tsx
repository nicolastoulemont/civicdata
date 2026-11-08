import { applies, type Transform, type View } from "@civicdata/domain"
import { Match, Schema } from "effect"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { withTransform } from "./edits.ts"

const choices = [
  { value: "Values", label: "Values" },
  { value: "PerPerson", label: "Per person" },
  { value: "Growth", label: "Growth" },
  { value: "Index", label: "Index" },
] as const

const isTransform = Schema.is(Schema.Literals(["PerPerson", "Growth", "Index"]))

// What the chart shows: the indicator's values, or a transform of them. A
// transform the indicator cannot take is disabled; a ranking cannot be indexed.
export const ShowAs = ({
  view,
  name,
  onChange,
}: {
  view: View
  // The indicator's name once loaded; until then every transform is offered.
  name: string | undefined
  onChange: (view: View) => void
}) => {
  const offered = Match.valueTags(view, {
    Trend: () => choices,
    Ranking: () => choices.filter((choice) => choice.value !== "Index"),
  })

  const available = (transform: Transform) => name === undefined || applies(transform, name)

  return (
    <ToggleGroup
      aria-label="Show as"
      variant="outline"
      value={[view.transform ?? "Values"]}
      onValueChange={(next: Array<string>) => {
        const [picked] = next

        if (picked !== undefined)
          onChange(withTransform(view, isTransform(picked) ? picked : undefined))
      }}
    >
      {offered.map((choice) => (
        <ToggleGroupItem
          key={choice.value}
          value={choice.value}
          disabled={choice.value !== "Values" && !available(choice.value)}
        >
          {choice.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
