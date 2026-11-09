import type { Code, Dimension, View } from "@civicdata/domain"
import { useId } from "react"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { withPick } from "./edits.ts"

const Pick = ({
  dimension,
  value,
  onChange,
}: {
  dimension: Dimension
  value: Code | undefined
  onChange: (code: Code) => void
}) => {
  const id = useId()

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
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
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

// One select per dimension an SDMX indicator's series differ by, such as sex
// or age, showing the value the View picks.
export const Dimensions = ({
  view,
  dimensions,
  onChange,
}: {
  view: View
  dimensions: ReadonlyArray<Dimension>
  onChange: (view: View) => void
}) =>
  dimensions.map((dimension) => (
    <Pick
      key={dimension.id}
      dimension={dimension}
      value={view.dimensions?.[dimension.id]}
      onChange={(code) => onChange(withPick(view, { id: dimension.id, code }))}
    />
  ))
