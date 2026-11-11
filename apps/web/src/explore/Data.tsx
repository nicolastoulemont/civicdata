import type { Country, Flag, ResolvedView } from "@civicdata/domain"
import { Download } from "lucide-react"
import { use } from "react"

import { Act } from "@/act"
import { buttonVariants } from "@/components/ui/button"
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

type At = { readonly country: Country; readonly year: number }

const find = (observations: ResolvedView["observations"], { country, year }: At) =>
  observations.find((observation) => observation.country === country && observation.year === year)

const flagged = (flags: ReadonlyArray<Flag>) =>
  [...new Set(flags)].map((flag) => flagLabels[flag].toLowerCase()).join(", ")

// The table behind the chart: a value column per indicator it plots, headed
// by the indicator's title, with a row per country and year.
const tableOf = (resolved: ResolvedView) => {
  const order = (country: Country) => resolved.view.countries.indexOf(country)

  // A relation lists each country in its year, or over time in each year
  // either indicator has a value.
  if ("against" in resolved) {
    const { span, year: one } = resolved.view
    const { observations, against } = resolved

    const years =
      span === undefined
        ? [one]
        : [...new Set([...observations, ...against.observations].map(({ year }) => year))].toSorted(
            (left, right) => left - right,
          )

    return {
      columns: [
        { id: resolved.indicator.id, title: resolved.title },
        { id: against.indicator.id, title: against.title },
      ],
      rows: resolved.view.countries.flatMap((country) =>
        years.map((year) => {
          const own = find(observations, { country, year })
          const other = find(against.observations, { country, year })

          return {
            country,
            year,
            values: [own?.value, other?.value],
            flags: [...(own?.flags ?? []), ...(other?.flags ?? [])],
          }
        }),
      ),
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

interface DataProps {
  resolved: ResolvedView
}

// Every observation behind the chart, as a table and a CSV, with the
// exact request made to the source.
export const Data = ({ resolved }: DataProps) => {
  const act = use(Act)
  const table = tableOf(resolved)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv(table))}`}
          download={`${resolved.indicator.id}.csv`}
          onClick={() => act("download")}
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
    </div>
  )
}
