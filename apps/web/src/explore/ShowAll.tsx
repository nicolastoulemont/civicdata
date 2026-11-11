import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

// How many rows a ranking or a change shows before a person asks for all.
const first = 25

interface ShowAllProps<Row> {
  rows: ReadonlyArray<Row>
  children: (shown: ReadonlyArray<Row>) => ReactNode
}

// A chart of one row per country: the first 25 rows, then a button that
// names how many countries there are and shows them all.
export const ShowAll = <Row,>({ rows, children }: ShowAllProps<Row>) => {
  const { t } = useTranslation("explore")

  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, first)

  return (
    <>
      {children(shown)}
      {shown.length < rows.length ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setAll(true)}>
          {t(($) => $["Show all {{value1}} countries"], { value1: rows.length })}
        </Button>
      ) : null}
    </>
  )
}
