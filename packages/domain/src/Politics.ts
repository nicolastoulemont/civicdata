import { Schema, SchemaGetter } from "effect"

import { Country } from "./Country.ts"
import { IndicatorId } from "./Indicator.ts"
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

// A party's colour and the page that sets it: the party's own brand, or a
// representative colour from Wikidata's "sRGB colour" (P465). It identifies
// the party; it says nothing about where the party stands.
export const PartyColor = Schema.Struct({
  hex: Schema.String.check(Schema.isPattern(/^#[0-9A-F]{6}$/)),
  kind: Schema.Literals(["brand", "representative"]),
  url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/)),
})

export interface PartyColor extends Schema.Schema.Type<typeof PartyColor> {}

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
// that it had no parties. Its colour is its head's party's, when its
// publisher names exactly one party as the head's and that party has a
// sourced colour; otherwise none.
const Government = Schema.Struct({
  country: Country,
  head: Schema.NonEmptyString,
  parties: Schema.Array(Party),
  color: Schema.NullOr(PartyColor),
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

// A date as precise as its source gives it: a year (1973), a month
// (2010-05) or a day (1990-10-03). A missing month or day is never filled in.
export const Moment = Schema.String.check(
  Schema.makeFilter((moment: string) => {
    const [, month] = /^\d{4}(?:-(\d{2}))?$/.exec(moment) ?? []

    return (
      moment.length === 4 ||
      (month !== undefined && Number(month) >= 1 && Number(month) <= 12) ||
      Schema.is(Day)(moment) ||
      "a year, YYYY-MM or YYYY-MM-DD"
    )
  }),
).pipe(Schema.brand("Moment"))

export type Moment = typeof Moment.Type

// A moment its source gives as approximate: "about 1973".
const Dated = Schema.Struct({ date: Moment, approximate: Schema.Boolean })

// When an event happened: at one moment, or over a period. A period without
// an end (`to` null) is still going on.
export const When = Schema.TaggedUnion({
  Point: { at: Dated },
  Period: { from: Dated, to: Schema.NullOr(Dated) },
})

export type When = typeof When.Type

// The countries an event concerns: every country, or those listed.
export const Scope = Schema.TaggedUnion({
  World: {},
  Countries: { countries: Schema.NonEmptyArray(Country).check(Schema.isUnique()) },
})

export type Scope = typeof Scope.Type

const Slug = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/))

// A page that establishes a record, and who published it.
const Reference = Schema.Struct({
  publisher: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  url: Schema.String.check(Schema.isPattern(/^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/)),
})

const Sources = Schema.NonEmptyArray(Reference)

// How an event is classified, as countries-comparison's history catalogue
// (docs/history.md there) defines each scale. Each describes the event, not
// its effect on any figure.
const Kind = Schema.Literals(["event", "programme", "trend", "statistical-break"])

const Reach = Schema.Literals(["national", "cross-border", "european", "worldwide"])

const Relation = Schema.Literals(["eu-specific", "eu-adjacent", "global-context"])

const Topic = Schema.Literals([
  "economy",
  "fiscal",
  "institutions",
  "defence",
  "health",
  "society",
  "energy",
  "environment",
  "territory",
])

// A statistical break changes how figures are measured; it alone has the
// "measurement" impact, outside the historical scale.
const Impact = Schema.Literals([
  "world-shaping",
  "structural",
  "bounded",
  "unassessed",
  "measurement",
])

// The last day a moment covers: 1975 runs to 1975-12-31.
const lastDay = (moment: Moment) => `${moment}${"-12-31".slice(moment.length - 4)}`

// A major event, programme or statistical break, with the countries it
// concerns and its sources. Its summary says what happened, never what it
// did to a line on a chart.
const Event = Schema.Struct({
  id: Slug,
  name: Schema.NonEmptyString,
  when: When,
  scope: Scope,
  summary: Schema.NonEmptyString,
  sources: Sources,
  kind: Kind,
  reach: Reach,
  relation: Relation,
  topics: Schema.NonEmptyArray(Topic).check(Schema.isUnique()),
  impact: Schema.Struct({ level: Impact, reason: Schema.NonEmptyString }),
}).check(
  Schema.makeFilter(
    (event) =>
      (event.kind === "statistical-break") === (event.impact.level === "measurement") ||
      "a statistical break, and only one, has the measurement impact",
  ),
  Schema.makeFilter(
    ({ when }) =>
      When.match(when, {
        Point: () => true,
        Period: ({ from, to }) => to === null || from.date <= lastDay(to.date),
      }) || "a period must end on or after its start",
  ),
)

export interface Event extends Schema.Schema.Type<typeof Event> {}

// The year a moment falls in: an annual chart's place for it.
export const yearOf = (moment: Moment) => Number(moment.slice(0, 4))

// The first and last year an event spans. One still going on has no last year.
export const yearsOf = (when: When): { readonly from: number; readonly to: number | null } =>
  When.match(when, {
    Point: ({ at }) => ({ from: yearOf(at.date), to: yearOf(at.date) }),
    Period: ({ from, to }) => ({
      from: yearOf(from.date),
      to: to === null ? null : yearOf(to.date),
    }),
  })

// Whether an event concerns a country.
export const covers = (scope: Scope, country: Country) =>
  Scope.match(scope, {
    World: () => true,
    Countries: ({ countries }) => countries.includes(country),
  })

// The policy areas reforms belong to.
export const PolicyArea = Schema.Literals(["pensions"])

export type PolicyArea = typeof PolicyArea.Type

// The indicators of each policy area: a reform shows on their charts only.
// Pensions are Eurostat's and the OECD's pension spending, beneficiaries,
// replacement rates, entitlements and pensioners' poverty, and the OECD's
// pension system and asset-backed pension series. The World Bank publishes
// no pension series.
export const areas: Record<PolicyArea, ReadonlySet<IndicatorId>> = {
  pensions: new Set(
    [
      "ESTAT,TPS00103,1.0",
      "ESTAT,SPR_EXP_PENS,1.0",
      "ESTAT,SPR_EXP_FOL,1.0",
      "ESTAT,SPR_PNS_BEN,1.0",
      "ESTAT,ILC_PNP3,1.0",
      "ESTAT,TESPN070,1.0",
      "ESTAT,ILC_PNS6,1.0",
      "ESTAT,TESPN100,1.0",
      "ESTAT,NASA_10_PENS1,1.0",
      "OECD.ELS.SPD,DSD_PAG@DF_PAG,1.0",
      "OECD.ELS.SPD,DSD_PAG@DF_PRR,1.0",
      "OECD.ELS.SPD,DSD_PAG@DF_PW,1.0",
      "OECD.ELS.SPD,DSD_PAG@DF_DPS,1.0",
      "OECD.SDD.NAD,DSD_NAPENS@DF_TABLE29,1.0",
      "OECD.DAF.CM,DSD_FP@DF_FPS,1.0",
    ].map((code) => IndicatorId.make(code)),
  ),
}

// A national policy reform, on the day it was adopted or the day its main
// provisions took effect, as `milestone` says. Its date is a year or a day,
// as its source gives it.
const Reform = Schema.Struct({
  id: Slug,
  country: Country,
  area: PolicyArea,
  date: Moment,
  milestone: Schema.Literals(["adopted", "in-force"]),
  name: Schema.NonEmptyString,
  summary: Schema.NonEmptyString,
  sources: Sources,
})

export interface Reform extends Schema.Schema.Type<typeof Reform> {}

// A political record's id, as the agent reads it in a lookup:
// "government:FRA:2017-05-15", "election:FRA:president:2017-04-23",
// "event:financial-crisis", "reform:fr-pensions-2010-woerth".
export const RecordId = Schema.String.check(
  Schema.isPattern(/^(?:government|election|event|reform):\S+$/),
).pipe(Schema.brand("RecordId"))

export type RecordId = typeof RecordId.Type

// One political record of any kind.
export const Cited = Schema.TaggedUnion({
  Government: { government: Government },
  Election: { election: Election },
  Event: { event: Event },
  Reform: { reform: Reform },
})

export type Cited = typeof Cited.Type

// A record's id. A country has one government starting on a day, and one
// election of a ballot on a polling day; events and reforms have ids of
// their own.
export const idOf = (cited: Cited): RecordId =>
  RecordId.make(
    Cited.match(cited, {
      Government: ({ government }) => `government:${government.country}:${government.start}`,
      Election: ({ election }) =>
        `election:${election.country}:${election.ballot}:${election.date}`,
      Event: ({ event }) => `event:${event.id}`,
      Reform: ({ reform }) => `reform:${reform.id}`,
    }),
  )

// What a trend chart can draw over its lines besides the data: elections,
// governments, and events with reforms. Kept beside a chart, never in its
// View: the explorer keeps it in the card and its link, an answer with each
// of its charts.
export const Overlay = Schema.Literals(["elections", "governments", "events"])

export type Overlay = typeof Overlay.Type

// The overlays a chart draws, each once.
export const Overlays = Schema.NonEmptyArray(Overlay).check(Schema.isUnique())

export type Overlays = typeof Overlays.Type

// The political records of some countries over some years: their
// governments and elections, the events that concern them, and their reforms.
export const Politics = Schema.Struct({
  governments: Schema.Array(Government),
  elections: Schema.Array(Election),
  events: Schema.Array(Event),
  reforms: Schema.Array(Reform),
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
