import {
  CatalogUnavailable,
  type CatalogEntry,
  type IndicatorId,
  SourceUnavailable,
} from "@civicdata/domain"
import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import { Data, Match } from "effect"
import type { TFunction } from "i18next"
import { useDeferredValue, useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Field, FieldLabel } from "@/components/ui/field"

import { searchQuery } from "./api.ts"

const problem = (error: Error, t: TFunction<"explore">) =>
  error instanceof CatalogUnavailable
    ? t(($) => $.catalogUnavailable)
    : error instanceof SourceUnavailable
      ? t(($) => $["The World Bank catalog is not responding. Try again in a moment."])
      : t(($) => $["Indicator search failed."])

// Where the search for the typed text stands. Idle until two characters are
// typed, so a pick, which clears the text, lists no earlier results. While
// the results for the text load, the previous text's stay listed.
type Status = Data.TaggedEnum<{
  Idle: {}
  Searching: { readonly previous: ReadonlyArray<CatalogEntry> }
  Found: { readonly entries: ReadonlyArray<CatalogEntry> }
  Empty: {}
  Failed: { readonly error: Error }
}>

const Status = Data.taggedEnum<Status>()

interface Typed {
  readonly text: string
  // The text the query searches, which trails `text` while React defers it.
  readonly searched: string
}

const statusOf = (
  { text, searched }: Typed,
  search: UseQueryResult<ReadonlyArray<CatalogEntry>>,
): Status => {
  if (text.length < 2) return Status.Idle()

  if (search.isError) return Status.Failed({ error: search.error })

  if (search.isPending) return Status.Searching({ previous: [] })

  if (search.isPlaceholderData || searched !== text)
    return Status.Searching({ previous: search.data })

  return search.data.length === 0 ? Status.Empty() : Status.Found({ entries: search.data })
}

// The line under the search box: what the search is doing, why there are no
// results, or nothing.
const line = (status: Status, t: TFunction<"explore">) =>
  Match.valueTags(status, {
    Idle: () => null,
    Searching: () => t(($) => $["Searching…"]),
    Found: () => null,
    Empty: () => t(($) => $["No indicator matches."]),
    Failed: ({ error }) => problem(error, t),
  })

const listed = (status: Status): ReadonlyArray<CatalogEntry> =>
  Match.valueTags(status, {
    Idle: () => [],
    Searching: ({ previous }) => previous,
    Found: ({ entries }) => entries,
    Empty: () => [],
    Failed: () => [],
  })

interface IndicatorProps {
  // Names which of the chart's indicators this picks, e.g. "Against".
  label?: string
  current: { readonly indicator: IndicatorId; readonly name: string }
  onChange: (picked: { readonly id: IndicatorId; readonly name: string }) => void
}

// Switches the chart to another indicator found by name, definition or code.
// The current indicator stays among the options so it remains selected while
// search results change.
export const Indicator = ({ label, current, onChange }: IndicatorProps) => {
  const { t } = useTranslation("explore")

  const id = useId()
  const [text, setText] = useState("")
  const typed = text.trim()
  const searched = useDeferredValue(typed)
  const search = useQuery(searchQuery(searched))

  // A stable value: a new object on each render reads as a new selection,
  // and Base UI would rewrite the input with its name while the user types.
  const selected: CatalogEntry = useMemo(
    () => ({ indicator: current.indicator, name: current.name, definition: "" }),
    [current.indicator, current.name],
  )

  const status = statusOf({ text: typed, searched }, search)
  const found = listed(status)

  const items = found.some((entry) => entry.indicator === current.indicator)
    ? found
    : [selected, ...found]

  const shown = line(status, t)

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label ?? t(($) => $["Indicator"])}</FieldLabel>
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
          if (entry !== null && entry.indicator !== current.indicator)
            onChange({ id: entry.indicator, name: entry.name })
        }}
      >
        <ComboboxInput id={id} placeholder={t(($) => $["Search indicators"])} />
        <ComboboxContent>
          {shown === null ? null : (
            <output className="block px-3 py-2 text-sm text-muted-foreground">{shown}</output>
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
