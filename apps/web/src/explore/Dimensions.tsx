import type { Code, Dimension, View } from "@openfacts/domain"
import { useId } from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { withPick } from "./edits.ts"

interface PickProps {
  dimension: Dimension
  value: Code | undefined
  onChange: (code: Code) => void
}

// A source's labels can be long and differ only at the end, such as
// Eurostat's "Chain linked volumes, percentage change on previous period" and
// the same "per capita". The closed select shows what fits and the whole label
// on hover; the open list wraps each label in full.
const Pick = ({ dimension, value, onChange }: PickProps) => {
  const { t } = useTranslation("explore")

  const id = useId()
  const picked = dimension.options.find((option) => option.code === value)

  return (
    <Field className="w-56">
      <FieldLabel htmlFor={id}>{dimension.label}</FieldLabel>
      <Select
        value={value ?? null}
        items={dimension.options.map((option) => ({ value: option.code, label: option.label }))}
        onValueChange={(code: Code | null) => {
          if (code !== null) onChange(code)
        }}
      >
        <SelectTrigger id={id} className="w-full" title={picked?.label}>
          <SelectValue placeholder={t(($) => $["Choose…"])} />
        </SelectTrigger>
        <SelectContent className="w-auto max-w-[min(28rem,var(--available-width))] min-w-(--anchor-width)">
          {dimension.options.map((option) => (
            <SelectItem key={option.code} value={option.code}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

interface DimensionsProps {
  view: View
  dimensions: ReadonlyArray<Dimension>
  onChange: (view: View) => void
}

// One select per dimension an SDMX indicator's series differ by, such as sex
// or age, showing the value the View picks.
export const Dimensions = ({ view, dimensions, onChange }: DimensionsProps) =>
  dimensions.map((dimension) => (
    <Pick
      key={dimension.id}
      dimension={dimension}
      value={view.dimensions?.[dimension.id]}
      onChange={(code) => onChange(withPick(view, { id: dimension.id, code }))}
    />
  ))
