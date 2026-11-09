import type { Country, Flag, ResolvedView } from "@civicdata/domain"
import { ChevronDown, Download } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { countryName, flagLabels, formatValue, indicatorNames, transformLabel } from "./format.ts"

const quote = (field: string) => `"${field.replaceAll('"', '""')}"`

const valueOf = (observations: ResolvedView["observations"], country: Country) =>
  observations.find((observation) => observation.country === country)?.value

const flagsOf = (observations: ResolvedView["observations"], country: Country) =>
  observations.find((observation) => observation.country === country)?.flags ?? []

const flagged = (flags: ReadonlyArray<Flag>) =>
  [...new Set(flags)].map((flag) => flagLabels[flag].toLowerCase()).join(", ")

// The table behind the chart: a value column per indicator it plots, headed
// by the indicator's title, with a row per country and year.
const tableOf = (resolved: ResolvedView) => {
  const order = (country: Country) => resolved.view.countries.indexOf(country)

  if ("against" in resolved) {
    const year = resolved.view.year

    return {
      columns: [
        { id: resolved.indicator.id, title: resolved.title },
        { id: resolved.against.indicator.id, title: resolved.against.title },
      ],
      rows: resolved.view.countries.map((country) => ({
        country,
        year,
        values: [
          valueOf(resolved.observations, country),
          valueOf(resolved.against.observations, country),
        ],
        flags: [
          ...flagsOf(resolved.observations, country),
          ...flagsOf(resolved.against.observations, country),
        ],
      })),
    }
  }

  const shows = transformLabel(resolved.view, indicatorNames([resolved]))

  return {
    columns: [{ id: "value", title: shows === undefined ? "Value" : `Value (${shows})` }],
    rows: resolved.observations
      .toSorted(
        (left, right) => order(left.country) - order(right.country) || left.year - right.year,
      )
      .map(({ country, year, value, flags }) => ({
        country,
        year,
        values: [value],
        flags: flags ?? [],
      })),
  }
}

const csv = ({ columns, rows }: ReturnType<typeof tableOf>) =>
  [
    ["country_code", "country", "year", ...columns.map((column) => column.id), "flags"].join(","),
    ...rows.map(({ country, year, values, flags }) =>
      [
        country,
        quote(countryName(country)),
        year,
        ...values.map((value) => value ?? ""),
        quote(flagged(flags)),
      ].join(","),
    ),
  ].join("\n")

// Level 3: every observation behind the chart, as a table and a CSV, with the
// exact request made to the source.
export const Data = ({ resolved }: { resolved: ResolvedView }) => {
  const table = tableOf(resolved)

  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger
        className={buttonVariants({ variant: "ghost", className: "w-full justify-between" })}
      >
        Data
        <ChevronDown aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-4 pb-4">
        <div className="flex flex-wrap gap-2">
          <a
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv(table))}`}
            download={`${resolved.indicator.id}.csv`}
          >
            <Download data-icon="inline-start" aria-hidden />
            Download CSV
          </a>
          {resolved.sources.map((source) => (
            <a
              key={source.indicator}
              className={buttonVariants({ variant: "link", size: "sm" })}
              href={source.url}
            >
              {source.indicator} request
            </a>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead>Year</TableHead>
              {table.columns.map((column) => (
                <TableHead key={column.id} className="text-right">
                  {column.title}
                </TableHead>
              ))}
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map(({ country, year, values, flags }) => (
              <TableRow key={`${country}-${year}`}>
                <TableCell>{countryName(country)}</TableCell>
                <TableCell>{year}</TableCell>
                {values.map((value, index) => (
                  <TableCell key={table.columns[index]?.id} className="text-right tabular-nums">
                    {value === undefined ? "No data" : formatValue(value)}
                  </TableCell>
                ))}
                <TableCell className="text-muted-foreground">{flagged(flags)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  )
}
