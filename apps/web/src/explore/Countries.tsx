import { type Country, countries, type View } from "@civicdata/domain"
import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
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

// Collapsed, the field shows the first 3 countries and a button for the rest.
// The button appears from 5 countries: at 4 it would hide a single chip
// behind a chip of its own.
const first = 3
const collapseFrom = 5

interface CountriesProps {
  selected: View["countries"]
  onChange: (countries: View["countries"]) => void
}

// A View always has at least one country, so the last chip has no remove button.
export const Countries = ({ selected, onChange }: CountriesProps) => {
  const anchor = useComboboxAnchor()
  const id = useId()
  // The countries the field was expanded for. Countries changed from outside
  // the field, as a new chart does, no longer match, so the field collapses.
  // The parent may rebuild the list on every render, so this compares values.
  const [expandedFor, setExpandedFor] = useState<string>()
  const expanded = expandedFor === selected.join()
  const collapsed = !expanded && selected.length >= collapseFrom

  return (
    <Field>
      <FieldLabel htmlFor={id}>Countries</FieldLabel>
      <Combobox
        items={codes}
        multiple
        value={[...selected]}
        itemToStringLabel={countryName}
        onValueChange={(next: Array<Country>) => {
          const [head, ...rest] = next

          if (head === undefined) return

          if (expanded) setExpandedFor(next.join())
          onChange([head, ...rest])
        }}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(chosen: Array<Country>) => (
              <>
                {(collapsed ? chosen.slice(0, first) : chosen).map((country) => (
                  <ComboboxChip
                    key={country}
                    showRemove={chosen.length > 1}
                    removeLabel={`Remove ${countryName(country)}`}
                  >
                    {countryName(country)}
                  </ComboboxChip>
                ))}
                {/* One button in one place, so focus stays on it as it toggles. */}
                {chosen.length >= collapseFrom ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-[calc(--spacing(5.25))] rounded-sm px-1.5 text-muted-foreground"
                    aria-label={
                      collapsed ? `Show all ${chosen.length} countries` : "Show fewer countries"
                    }
                    onClick={() => setExpandedFor(collapsed ? selected.join() : undefined)}
                  >
                    {collapsed ? `+${chosen.length - first} more` : "Show less"}
                  </Button>
                ) : null}
                {/* The label names the input either way; the hint shows only with no chip. */}
                <ComboboxChipsInput
                  id={id}
                  placeholder={chosen.length === 0 ? "Add a country" : undefined}
                  // Base UI's Backspace removes the last chip shown. Collapsed,
                  // that is the third country, not the last one, so it removes none.
                  onKeyDown={(event) => {
                    if (collapsed && event.key === "Backspace" && event.currentTarget.value === "")
                      event.preventBaseUIHandler()
                  }}
                />
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
