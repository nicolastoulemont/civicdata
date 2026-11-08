import type { ResolvedView } from "@civicdata/domain"
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

import { countryName, formatValue } from "./format.ts"

const quote = (field: string) => `"${field.replaceAll('"', '""')}"`

const csv = (resolved: ResolvedView) =>
  [
    "country_code,country,year,value",
    ...resolved.observations.map(({ country, year, value }) =>
      [country, quote(countryName(country)), year, value].join(","),
    ),
  ].join("\n")

// Level 3: every observation behind the chart, as a table and a CSV, with the
// exact request made to the source.
export const Data = ({ resolved }: { resolved: ResolvedView }) => {
  const rows = resolved.observations.toSorted(
    (left, right) =>
      resolved.view.countries.indexOf(left.country) -
        resolved.view.countries.indexOf(right.country) || left.year - right.year,
  )

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
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv(resolved))}`}
            download={`${resolved.indicator.id}.csv`}
          >
            <Download data-icon="inline-start" aria-hidden />
            Download CSV
          </a>
          <a
            className={buttonVariants({ variant: "link", size: "sm" })}
            href={resolved.provenance.url}
          >
            Source request
          </a>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ country, year, value }) => (
              <TableRow key={`${country}-${year}`}>
                <TableCell>{countryName(country)}</TableCell>
                <TableCell>{year}</TableCell>
                <TableCell className="text-right tabular-nums">{formatValue(value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  )
}
