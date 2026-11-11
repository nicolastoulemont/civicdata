import type { Country, Flag, ResolvedView } from "@civicdata/domain"
import type { TFunction } from "i18next"
import { Download } from "lucide-react"
import { use } from "react"
import { useTranslation } from "react-i18next"

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

import {
  countryName as englishCountryName,
  flagLabels as englishFlagLabels,
  indicatorNames,
} from "./format.ts"
import { useFormat } from "./useFormat.ts"

const quote = (field: string) => `"${field.replaceAll('"', '""')}"`

type At = { readonly country: Country; readonly year: number }

const find = (observations: ResolvedView["observations"], { country, year }: At) =>
  observations.find((observation) => observation.country === country && observation.year === year)

const flagged = (flags: ReadonlyArray<Flag>) =>
  [...new Set(flags)].map((flag) => englishFlagLabels[flag].toLowerCase()).join(", ")

// The table behind the chart: a value column per indicator it plots, headed
// by the indicator's title, with a row per country and year.
const tableOf = (
  resolved: ResolvedView,
  { t, format }: { t: TFunction<"explore">; format: ReturnType<typeof useFormat> },
) => {
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

  const shows = format.transformLabel(resolved.view, indicatorNames([resolved]))

  return {
    columns: [
      {
        id: "value",
        title:
          shows === undefined ? t(($) => $["Value"]) : t(($) => $["Value ({{shows}})"], { shows }),
      },
    ],
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
        quote(englishCountryName(country)),
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
  const format = useFormat()
  const { countryName, formatValue, flagLabels } = format

  const { t } = useTranslation("explore")

  const act = use(Act)
  const table = tableOf(resolved, { t, format })

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
          {t(($) => $["Download CSV"])}
        </a>
        {resolved.sources.map((source) => (
          <a
            key={source.indicator}
            className={buttonVariants({ variant: "link", size: "sm" })}
            href={source.url}
          >
            {t(($) => $["{{value}} request"], { value: source.indicator })}
          </a>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(($) => $["Country"])}</TableHead>
            <TableHead>{t(($) => $["Year"])}</TableHead>
            {table.columns.map((column) => (
              <TableHead key={column.id} className="text-right">
                {column.title}
              </TableHead>
            ))}
            <TableHead>{t(($) => $["Flags"])}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map(({ country, year, values, flags }) => (
            <TableRow key={`${country}-${year}`}>
              <TableCell>{countryName(country)}</TableCell>
              <TableCell>{year}</TableCell>
              {values.map((value, index) => (
                <TableCell key={table.columns[index]?.id} className="text-right tabular-nums">
                  {value === undefined ? t(($) => $["No data"]) : formatValue(value)}
                </TableCell>
              ))}
              <TableCell className="text-muted-foreground">
                {[...new Set(flags)].map((flag) => flagLabels[flag].toLowerCase()).join(", ")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
