import {
  CatalogUnavailable,
  type CatalogEntry,
  type IndicatorId,
  SourceUnavailable,
} from "@civicdata/domain"
import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import { useDeferredValue, useId, useMemo, useState } from "react"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Field, FieldLabel } from "@/components/ui/field"

import { searchQuery } from "./api.ts"

const problem = (error: Error) =>
  error instanceof CatalogUnavailable
    ? "Indicator search needs the Workers runtime (alchemy dev)."
    : error instanceof SourceUnavailable
      ? "The World Bank catalog is not responding. Try again in a moment."
      : "Indicator search failed."

// The line under the search box: why there are no results, or nothing.
const statusOf = (text: string, search: UseQueryResult<ReadonlyArray<CatalogEntry>>) => {
  if (text.length < 2) return null

  if (search.isError) return problem(search.error)

  if (search.isPending) return "Searching…"

  return search.data.length === 0 ? "No indicator matches." : null
}

// Switches the chart to another indicator found by name, definition or code.
// The current indicator stays among the options so it remains selected while
// search results change.
export const Indicator = ({
  current,
  onChange,
}: {
  current: { readonly indicator: IndicatorId; readonly name: string }
  onChange: (indicator: IndicatorId) => void
}) => {
  const id = useId()
  const [text, setText] = useState("")
  const search = useQuery(searchQuery(useDeferredValue(text.trim())))

  // A stable value: a new object on each render reads as a new selection,
  // and Base UI would rewrite the input with its name while the user types.
  const selected: CatalogEntry = useMemo(
    () => ({ indicator: current.indicator, name: current.name, definition: "" }),
    [current.indicator, current.name],
  )

  const found = search.data ?? []

  const items = found.some((entry) => entry.indicator === current.indicator)
    ? found
    : [selected, ...found]

  const status = statusOf(text.trim(), search)

  return (
    <Field>
      <FieldLabel htmlFor={id}>Indicator</FieldLabel>
      <Combobox
        items={items}
        value={selected}
        filter={null}
        itemToStringLabel={(entry: CatalogEntry) => entry.name}
        isItemEqualToValue={(item: CatalogEntry, value: CatalogEntry) =>
          item.indicator === value.indicator
        }
        // Search what the user types. Base UI also writes the selected
        // indicator's name into the input, which must not start a search.
        onInputValueChange={(next: string, details) =>
          setText(details.reason === "input-change" ? next : "")
        }
        onValueChange={(entry: CatalogEntry | null) => {
          if (entry !== null && entry.indicator !== current.indicator) onChange(entry.indicator)
        }}
      >
        <ComboboxInput id={id} placeholder="Search indicators" />
        <ComboboxContent>
          {status === null ? null : (
            <output className="block px-3 py-2 text-sm text-muted-foreground">{status}</output>
          )}
          <ComboboxList>
            {(entry: CatalogEntry) => (
              <ComboboxItem key={entry.indicator} value={entry}>
                {entry.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}
