import { type Country, countries, type View } from "@openfacts/domain"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"

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

import { useFormat } from "./useFormat.ts"

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
  const { countryName } = useFormat()

  const { t } = useTranslation("explore")

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
      <FieldLabel htmlFor={id}>{t(($) => $["Countries"])}</FieldLabel>
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
        {/* Collapsed, the field keeps to one line and long names shorten. While
            typing, it wraps so the input has room beside full names. */}
        <ComboboxChips
          ref={anchor}
          className={collapsed ? "flex-nowrap has-[input:focus]:flex-wrap" : undefined}
        >
          <ComboboxValue>
            {(chosen: Array<Country>) => (
              <>
                {(collapsed ? chosen.slice(0, first) : chosen).map((country) => (
                  <ComboboxChip
                    key={country}
                    showRemove={chosen.length > 1}
                    removeLabel={t(($) => $["Remove {{value1}}"], { value1: countryName(country) })}
                    className="min-w-0"
                  >
                    <span className="truncate">{countryName(country)}</span>
                  </ComboboxChip>
                ))}
                {/* One button in one place, so focus stays on it as it toggles. */}
                {chosen.length >= collapseFrom ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-[calc(--spacing(5.25))] shrink-0 rounded-sm px-1.5 text-muted-foreground"
                    aria-label={
                      collapsed
                        ? t(($) => $["Show all {{value1}} countries"], { value1: chosen.length })
                        : t(($) => $["Show fewer countries"])
                    }
                    onClick={() => setExpandedFor(collapsed ? selected.join() : undefined)}
                  >
                    {collapsed
                      ? t(($) => $["+{{value1}} more"], { value1: chosen.length - first })
                      : t(($) => $["Show less"])}
                  </Button>
                ) : null}
                {/* The label names the input either way; the hint shows only with no chip. */}
                <ComboboxChipsInput
                  id={id}
                  // Without text, the input drops the gap before it, so it never
                  // shortens the chips beside it.
                  className={collapsed ? "-ml-1 min-w-0 focus:ml-0 focus:min-w-16" : undefined}
                  placeholder={chosen.length === 0 ? t(($) => $["Add a country"]) : undefined}
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
          <ComboboxEmpty>{t(($) => $["No country matches."])}</ComboboxEmpty>
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
