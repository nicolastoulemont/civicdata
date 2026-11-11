import { applies, kindOf, type Transform, transformOf, type View } from "@civicdata/domain"
import { Match } from "effect"
import { useTranslation } from "react-i18next"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { ratioFor, withTransform } from "./edits.ts"

type Choice = "Values" | "PerPerson" | "Growth" | "Index" | "Ratio"

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
  const { t } = useTranslation("explore")

  const choices = [
    { value: "Values", label: t(($) => $["Values"]) },
    { value: "PerPerson", label: t(($) => $["Per person"]) },
    { value: "Growth", label: t(($) => $["Growth"]) },
    { value: "Index", label: t(($) => $["Index"]) },
    { value: "Ratio", label: t(($) => $["Ratio"]) },
  ] as const

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
      aria-label={t(($) => $["Show as"])}
      className="flex-wrap"
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
