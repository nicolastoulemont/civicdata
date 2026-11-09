import { Schema, SchemaGetter } from "effect"

import { Country } from "./Country.ts"
import { Year } from "./View.ts"

// A calendar day as its publisher writes it: 2011-12-21.
export const Day = Schema.String.check(
  Schema.makeFilter((day: string) => {
    const time = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day) : Number.NaN

    // Date.parse rolls 2011-02-30 over to March; the round trip catches it.
    return (
      (Number.isFinite(time) && new Date(time).toISOString().startsWith(day)) ||
      "a calendar day, YYYY-MM-DD"
    )
  }),
).pipe(Schema.brand("Day"))

// The countries with political records: the members of the EU and the OECD.
// The last five are EU members outside the OECD.
export const members: ReadonlySet<Country> = new Set<Country>([
  "AUS",
  "AUT",
  "BEL",
  "CAN",
  "CHE",
  "CHL",
  "COL",
  "CRI",
  "CZE",
  "DEU",
  "DNK",
  "ESP",
  "EST",
  "FIN",
  "FRA",
  "GBR",
  "GRC",
  "HUN",
  "IRL",
  "ISL",
  "ISR",
  "ITA",
  "JPN",
  "KOR",
  "LTU",
  "LUX",
  "LVA",
  "MEX",
  "NLD",
  "NOR",
  "NZL",
  "POL",
  "PRT",
  "SVK",
  "SVN",
  "SWE",
  "TUR",
  "USA",
  "BGR",
  "CYP",
  "HRV",
  "MLT",
  "ROU",
])

// Who published a political record. PPEG (WZB Berlin) and ParlGov are
// research archives; Official is a government, presidency or parliament
// record checked by hand after the archives end.
export const Publisher = Schema.Literals(["PPEG", "ParlGov", "Official"])

export type Publisher = typeof Publisher.Type

// Where one record comes from: the file or page it was read from, and when.
const Citation = Schema.Struct({
  publisher: Publisher,
  url: Schema.NonEmptyString,
  retrievedAt: Schema.DateTimeUtc,
})

// A party in government, as its publisher names it. Parliamentary support
// parties are not governing parties.
export const Party = Schema.Struct({
  name: Schema.NonEmptyString,
  abbreviation: Schema.NullOr(Schema.NonEmptyString),
})

export interface Party extends Schema.Schema.Type<typeof Party> {}

// How a government's time in office ends. The sources record when each
// government starts, never when it ends: a government ends when the next one
// starts (Next), was still in office when its publisher's records end
// (Cutoff), or has no recorded end (Open).
export const End = Schema.TaggedUnion({
  Next: { day: Day },
  Cutoff: { day: Day },
  Open: {},
})

// One government: a cabinet with its head and governing parties, from its
// start. An empty party list means its composition is not established, not
// that it had no parties.
const Government = Schema.Struct({
  country: Country,
  head: Schema.NonEmptyString,
  parties: Schema.Array(Party),
  start: Day,
  end: End,
  citation: Citation,
})

export interface Government extends Schema.Schema.Type<typeof Government> {}

// What a national election chose: the lower house of parliament, a
// president by popular vote, or a president by a vote of parliament.
// European Parliament elections are not national records here.
export const Ballot = Schema.Literals(["parliament", "president", "president-indirect"])

export type Ballot = typeof Ballot.Type

// One national election, on its polling day. A presidential election held in
// rounds has the day of its last round too. An election says nothing about
// who won or who governed after it.
const Election = Schema.Struct({
  country: Country,
  ballot: Ballot,
  date: Day,
  lastRound: Schema.NullOr(Day),
  citation: Citation,
})

export interface Election extends Schema.Schema.Type<typeof Election> {}

// The political records of some countries over some years.
export const Politics = Schema.Struct({
  governments: Schema.Array(Government),
  elections: Schema.Array(Election),
})

export interface Politics extends Schema.Schema.Type<typeof Politics> {}

// "FRA,DEU" ⇄ ["FRA", "DEU"], as a query parameter.
const CountryList = Schema.String.pipe(
  Schema.decodeTo(Schema.Array(Schema.String), {
    decode: SchemaGetter.split(),
    encode: SchemaGetter.transform((list) => list.join(",")),
  }),
  Schema.decodeTo(Schema.NonEmptyArray(Country).check(Schema.isUnique())),
)

// Which countries and years to read the records of. A year counts whole:
// a government in office on any day of it is in, and an election with any
// round in it.
export const PoliticsQuery = {
  countries: CountryList,
  from: Schema.FiniteFromString.pipe(Schema.decodeTo(Year)),
  to: Schema.FiniteFromString.pipe(Schema.decodeTo(Year)),
}
