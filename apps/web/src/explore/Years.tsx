import { Year } from "@civicdata/domain"
import { useId } from "react"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const first = 1960

export const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => Year.make(from + index))

// Every year the World Bank could have data for, up to the current one. Read
// inside render: Workers freeze the clock at module scope.
export const years = () => range(first, new Date().getUTCFullYear())

export const YearSelect = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: Year
  options: ReadonlyArray<Year>
  onChange: (year: Year) => void
}) => {
  const id = useId()

  return (
    <Field className="w-32">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(year: Year | null) => {
          if (year !== null) onChange(year)
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((year) => (
            <SelectItem key={year} value={year}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
