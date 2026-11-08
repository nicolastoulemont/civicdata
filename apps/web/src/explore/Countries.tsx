import { type Country, countries, type View } from "@civicdata/domain"
import { useId } from "react"

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import { Field, FieldLabel } from "@/components/ui/field"

import { countryName } from "./format.ts"

const codes = countries.map((country) => country.code)

// A View always has at least one country, so the last chip has no remove button.
export const Countries = ({
  selected,
  onChange,
}: {
  selected: View["countries"]
  onChange: (countries: View["countries"]) => void
}) => {
  const anchor = useComboboxAnchor()
  const id = useId()

  return (
    <Field>
      <FieldLabel htmlFor={id}>Countries</FieldLabel>
      <Combobox
        items={codes}
        multiple
        value={[...selected]}
        itemToStringLabel={countryName}
        onValueChange={(next: Array<Country>) => {
          const [first, ...rest] = next

          if (first !== undefined) onChange([first, ...rest])
        }}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(chosen: Array<Country>) => (
              <>
                {chosen.map((country) => (
                  <ComboboxChip
                    key={country}
                    showRemove={chosen.length > 1}
                    removeLabel={`Remove ${countryName(country)}`}
                  >
                    {countryName(country)}
                  </ComboboxChip>
                ))}
                <ComboboxChipsInput id={id} placeholder="Add a country" />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No country matches.</ComboboxEmpty>
          <ComboboxList>
            {(country: Country) => (
              <ComboboxItem key={country} value={country}>
                {countryName(country)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}
