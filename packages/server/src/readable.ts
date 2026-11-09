import { Rejection } from "@civicdata/domain"
import { Match, Option, Schema } from "effect"

// The chart types show_chart draws. A map is a ranking drawn on a world map.
export const Form = Schema.Literals(["trend", "ranking", "map", "change", "relation"])

export type Form = typeof Form.Type

// How many countries each chart type shows before a person can no longer
// read it. These bind the agent only: a person can still draw any chart.
// - A trend tells its lines apart by colour, and the palette has six. Past
//   five or six lines a reader cannot match a line to its country.
// - A ranking or a change gives each country a row; past 40 rows the labels
//   crowd and a map shows the same values better.
// - A map of fewer than 10 countries is mostly empty land; bars compare them.
// - A relation of fewer than 5 dots shows no pattern: two or three dots fit
//   any line.
export const limits = {
  trend: { most: 6 },
  ranking: { most: 40 },
  change: { most: 40 },
  map: { least: 10 },
  relation: { least: 5 },
} as const

// Why a chart cannot be read.
export type Unreadable = typeof Rejection.cases.TooMany.Type | typeof Rejection.cases.TooFew.Type

// Why a chart of type `form` with `countries` countries cannot be read, if
// it cannot.
export const unreadable = (form: Form, countries: number): Option.Option<Unreadable> =>
  Match.value(form).pipe(
    Match.whenOr("trend", "ranking", "change", (crowded) => {
      const { most } = limits[crowded]

      return countries > most
        ? Option.some<Unreadable>(Rejection.cases.TooMany.make({ most }))
        : Option.none()
    }),
    Match.whenOr("map", "relation", (sparse) => {
      const { least } = limits[sparse]

      return countries < least
        ? Option.some<Unreadable>(Rejection.cases.TooFew.make({ least }))
        : Option.none()
    }),
    Match.exhaustive,
  )
