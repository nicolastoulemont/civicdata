import { Ballot, countries, Country, Day, members, Party, Publisher } from "@openfacts/domain"
import { Context, DateTime, Effect, Layer, Match, Schedule, Schema } from "effect"
import { HttpClient } from "effect/http"
import { unzipSync } from "fflate"

import { geo } from "./geo.ts"
import ballots from "./official/elections.json"
import east from "./official/government-updates-east.json"
import west from "./official/government-updates-west.json"
import { table } from "./Table.ts"

// A governing party as its publisher records it, with the publisher's own id
// for it (PPEG's `party_id`, ParlGov's `party_id`) and whether the publisher
// names it as the head of government's party. Records checked by hand name
// parties without an id and never say which is the head's.
const PartyRecord = Schema.Struct({
  ...Party.fields,
  id: Schema.NullOr(Schema.NonEmptyString),
  lead: Schema.Boolean,
})

interface PartyRecord extends Schema.Schema.Type<typeof PartyRecord> {}

// One government as its publisher records it: when it started, who headed
// it, and its governing parties, the head's party first. `until` is the day
// the publisher's records end, for a government still in office then; the
// sources record no other ends.
export const GovernmentRecord = Schema.Struct({
  country: Country,
  head: Schema.NonEmptyString,
  parties: Schema.Array(PartyRecord),
  start: Day,
  until: Schema.NullOr(Day),
  url: Schema.NonEmptyString,
  retrievedAt: Schema.DateTimeUtc,
})

interface GovernmentRecord extends Schema.Schema.Type<typeof GovernmentRecord> {}

// One national election as its publisher records it, once however many
// parties or rounds its rows hold.
export const ElectionRecord = Schema.Struct({
  country: Country,
  ballot: Ballot,
  date: Day,
  lastRound: Schema.NullOr(Day),
  url: Schema.NonEmptyString,
  retrievedAt: Schema.DateTimeUtc,
})

interface ElectionRecord extends Schema.Schema.Type<typeof ElectionRecord> {}

// A publisher's records could not be fetched, or did not decode.
export class ArchiveUnavailable extends Schema.TaggedError<
  ArchiveUnavailable,
  { readonly brand: unique symbol }
>()("ArchiveUnavailable", { publisher: Publisher, cause: Schema.Defect() }) {}

interface Interface {
  // Every government a publisher records for the EU and OECD members.
  readonly governments: (
    publisher: Publisher,
  ) => Effect.Effect<ReadonlyArray<GovernmentRecord>, ArchiveUnavailable>
  // Every national election a publisher records for the EU and OECD members.
  readonly elections: (
    publisher: Publisher,
  ) => Effect.Effect<ReadonlyArray<ElectionRecord>, ArchiveUnavailable>
}

// Each record once, by its key: the first of several rows that describe it.
const distinct = <A>(records: ReadonlyArray<A>, key: (record: A) => string): Array<A> => [
  ...new Map(records.map((record): [string, A] => [key(record), record]).toReversed()).values(),
]

const isCountry = Schema.is(Country)

const member = (code: string | undefined) => isCountry(code) && members.has(code)

// PPEG 2025v1 (WZB Berlin), CC0 1.0: three ZIP archives, each a CSV with a
// row per party and cabinet, party and election, or candidate and election.
// Its government codebook
// (https://ppeg.wzb.eu/www/codebook_ppeg_gov_2025v1.pdf) defines a new cabinet
// by a change of prime minister, of party composition, or an election.
const ppeg = {
  governments: { url: "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip", file: "ppeg_gov_2025v1.csv" },
  parliaments: {
    url: "https://ppeg.wzb.eu/www/ppeg_parl_2025v1.zip",
    file: "ppeg_parl_2025v1.csv",
  },
  presidents: { url: "https://ppeg.wzb.eu/www/ppeg_pres_2025v1.zip", file: "ppeg_pres_2025v1.csv" },
  // The release's last day: cabinets inaugurated by 31 October 2025.
  cutoff: Day.make("2025-10-31"),
}

const PpegRow = Schema.Struct({
  iso3c: Country,
  idate: Day,
  pm: Schema.NonEmptyString,
  // Why the cabinet ended; "Notappl" when it was still in office at the cutoff.
  rft: Schema.Literals([
    "ElecParl",
    "ResPM",
    "ResPMHealth",
    "Diss",
    "LoPS",
    "IoHS",
    "ElecPres",
    "Other",
    "Notappl",
  ]),
  party_id: Schema.NonEmptyString,
  pname_en: Schema.NonEmptyString,
  pinitials: Schema.String,
  pm_party: Schema.Literals(["yes", "no"]),
  // "no" for parties that only supported the cabinet in parliament.
  gov_party: Schema.Literals(["yes", "no"]),
})

// "Rajoy, Mariano" → "Mariano Rajoy". A name without a comma stays as written.
const personal = (name: string) => {
  const at = name.indexOf(", ")

  return at === -1 ? name : `${name.slice(at + 2)} ${name.slice(0, at)}`
}

// The publisher writes "NA" for a party without initials.
const initials = (cell: string) => (cell === "NA" || cell === "" ? null : cell)

const ppegGovernments = Effect.fn("Archives.ppeg")(function* (
  csv: string,
  retrievedAt: DateTime.Utc,
) {
  const rows = (yield* table(csv)).filter((row) => member(row["iso3c"]))
  const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(PpegRow))(rows)

  // Each cabinet's parties, the head's first, under its country and day.
  const cabinets = new Map<
    string,
    {
      recorded: Omit<GovernmentRecord, "parties">
      lead: Array<PartyRecord>
      rest: Array<PartyRecord>
    }
  >()

  for (const row of decoded) {
    const key = `${row.iso3c} ${row.idate}`

    const cabinet = cabinets.get(key) ?? {
      recorded: {
        country: row.iso3c,
        head: personal(row.pm),
        start: row.idate,
        until: row.rft === "Notappl" ? ppeg.cutoff : null,
        url: ppeg.governments.url,
        retrievedAt,
      },
      lead: [],
      rest: [],
    }

    if (row.idate > ppeg.cutoff || cabinet.recorded.head !== personal(row.pm)) {
      return yield* Effect.fail(`PPEG cabinet ${key} is past the cutoff or has two heads`)
    }

    // Support parties back the cabinet in parliament but are not in it.
    if (row.gov_party === "yes") {
      const party = {
        name: row.pname_en,
        abbreviation: initials(row.pinitials),
        id: row.party_id,
        lead: row.pm_party === "yes",
      }

      if (party.lead) cabinet.lead.push(party)
      else cabinet.rest.push(party)
    }

    cabinets.set(key, cabinet)
  }

  return [...cabinets.values()].map(({ recorded, lead, rest }): GovernmentRecord =>
    Object.assign({ parties: [...lead, ...rest] }, recorded),
  )
})

const PpegElection = Schema.Struct({ iso3c: Country, edate: Day })

const PpegPresidential = Schema.Struct({
  iso3c: Country,
  // The first round, and the last when there were several ("NA" otherwise).
  edate: Day,
  edate_lastround: Schema.Union([Day, Schema.Literal("NA")]),
  // "yes" for a president who took office without an election.
  pres_not_by_elec: Schema.Literals(["yes", "no"]),
})

const memberRows = <A, I>(row: Schema.Codec<A, I>, csv: string) =>
  table(csv).pipe(
    Effect.map((rows) => rows.filter((each) => member(each["iso3c"]))),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(row))),
  )

const ppegElections = Effect.fn("Archives.ppegElections")(function* (
  files: { parliaments: string; presidents: string },
  retrievedAt: DateTime.Utc,
) {
  const parliaments = (yield* memberRows(PpegElection, files.parliaments)).map(
    (row): ElectionRecord => ({
      country: row.iso3c,
      ballot: "parliament",
      date: row.edate,
      lastRound: null,
      url: ppeg.parliaments.url,
      retrievedAt,
    }),
  )

  const presidents = (yield* memberRows(PpegPresidential, files.presidents)).flatMap(
    (row): Array<ElectionRecord> =>
      row.pres_not_by_elec === "yes"
        ? []
        : [
            {
              country: row.iso3c,
              ballot: "president",
              date: row.edate,
              lastRound:
                row.edate_lastround === "NA" || row.edate_lastround === row.edate
                  ? null
                  : row.edate_lastround,
              url: ppeg.presidents.url,
              retrievedAt,
            },
          ],
  )

  return distinct(
    [...parliaments, ...presidents],
    (record) => `${record.country} ${record.ballot} ${record.date}`,
  )
})

// ParlGov (Döring and Manow), CC0 1.0: cabinets named after their head, e.g.
// "Rajoy II", with their parties in separate tables.
const parlgov = {
  countries: "https://parlgov.fly.dev/data-csv/data_country/",
  cabinets: "https://parlgov.fly.dev/data-csv/data_cabinet/",
  members: "https://parlgov.fly.dev/data-csv/view_cabinet/",
  parties: "https://parlgov.fly.dev/data-csv/view_party/",
  // One row per party and election, the country by its ISO 3166 alpha-3 code.
  elections: "https://parlgov.fly.dev/data-csv/view_election/",
}

const ParlGovElection = Schema.Struct({
  country: Schema.String,
  date: Day,
  // European Parliament elections are not national records here.
  type: Schema.Literals(["parliament", "ep"]),
})

const ParlGovCountry = Schema.Struct({ id: Schema.NonEmptyString, name_short: Schema.String })

const ParlGovCabinet = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  start_date: Day,
  country_id: Schema.NonEmptyString,
})

const ParlGovMember = Schema.Struct({
  cabinet_id: Schema.NonEmptyString,
  party_id: Schema.NonEmptyString,
  party: Schema.String,
  // Whether the party holds the head of government.
  pm: Schema.Literals(["True", "False"]),
})

const ParlGovParty = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  name_english: Schema.String,
})

const decodeAll = <A, I>(row: Schema.Codec<A, I>, csv: string) =>
  table(csv).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(row))))

// "Rajoy II" → "Rajoy": the head, without the count of their cabinets.
const headOf = (cabinet: string) => cabinet.replace(/\s+[IVXLC]+$/, "")

const parlgovGovernments = Effect.fn("Archives.parlgov")(function* (
  files: { countries: string; cabinets: string; members: string; parties: string },
  retrievedAt: DateTime.Utc,
) {
  const codes = new Map(
    (yield* decodeAll(ParlGovCountry, files.countries)).map((row) => [row.id, row.name_short]),
  )

  const parties = new Map(
    (yield* decodeAll(ParlGovParty, files.parties)).map((row) => [row.id, row]),
  )

  const byCabinet = Map.groupBy(
    yield* decodeAll(ParlGovMember, files.members),
    (row) => row.cabinet_id,
  )

  return (yield* decodeAll(ParlGovCabinet, files.cabinets)).flatMap((cabinet) => {
    const country = codes.get(cabinet.country_id)

    if (!isCountry(country) || !members.has(country)) return []

    const named = (byCabinet.get(cabinet.id) ?? [])
      .toSorted((a, b) => Number(b.pm === "True") - Number(a.pm === "True"))
      .flatMap((row) => {
        const party = parties.get(row.party_id)

        return party === undefined
          ? []
          : [
              {
                name: party.name_english === "" ? party.name : party.name_english,
                abbreviation: row.party === "" ? null : row.party,
                id: row.party_id,
                lead: row.pm === "True",
              },
            ]
      })

    return [
      {
        country,
        head: headOf(cabinet.name),
        parties: named,
        start: cabinet.start_date,
        until: null,
        url: parlgov.cabinets,
        retrievedAt,
      },
    ]
  })
})

const parlgovElections = Effect.fn("Archives.parlgovElections")(function* (
  csv: string,
  retrievedAt: DateTime.Utc,
) {
  const rows = yield* decodeAll(ParlGovElection, csv)

  return distinct(
    rows.flatMap((row): Array<ElectionRecord> => {
      const country = row.country

      return row.type === "parliament" && isCountry(country) && members.has(country)
        ? [
            {
              country,
              ballot: "parliament",
              date: row.date,
              lastRound: null,
              url: parlgov.elections,
              retrievedAt,
            },
          ]
        : []
    }),
    (record) => `${record.country} ${record.date}`,
  )
})

// Formations checked by hand against government, presidency and parliament
// records after the archives end, copied from countries-comparison (see
// official/README.md). Each is a point observation: it starts a government
// and truncates the one before, but no end is known.
const Survey = Schema.Struct({
  checkedAt: Day,
  countries: Schema.Array(
    Schema.Struct({
      // Eurostat's code: EL for Greece.
      geo: Schema.String,
      formations: Schema.Array(
        Schema.Struct({
          start: Day,
          primeMinister: Schema.NonEmptyString,
          // Empty when the composition was not established.
          parties: Schema.Array(Schema.NonEmptyString),
          sources: Schema.NonEmptyArray(
            Schema.Struct({ title: Schema.NonEmptyString, url: Schema.NonEmptyString }),
          ),
        }),
      ),
    }),
  ),
})

const fromGeo = new Map<string, Country>(countries.map(({ code }) => [geo[code], code]))

const officialGovernments = Effect.fn("Archives.official")(function* () {
  const surveys = yield* Schema.decodeUnknownEffect(Schema.Array(Survey))([west, east])

  return surveys.flatMap((survey) =>
    survey.countries.flatMap(({ geo: code, formations }) => {
      const country = fromGeo.get(code)

      return country === undefined || !members.has(country)
        ? []
        : formations.map((formation) => ({
            country,
            head: formation.primeMinister,
            parties: formation.parties.map((name) => ({
              name,
              abbreviation: null,
              id: null,
              lead: false,
            })),
            start: formation.start,
            until: null,
            url: formation.sources[0].url,
            retrievedAt: DateTime.makeUnsafe(survey.checkedAt),
          }))
    }),
  )
})

// Elections held after the archives end, checked by hand against the
// electoral authorities' result tables, copied from countries-comparison
// (see official/README.md). One entry per ballot: a presidential election
// with a runoff has an entry per round.
const Ballots = Schema.Array(
  Schema.Struct({
    geo: Schema.String,
    kind: Ballot,
    election_date: Day,
    date: Day,
    url: Schema.NonEmptyString,
    retrieved: Day,
  }),
)

const officialElections = Effect.fn("Archives.officialElections")(function* () {
  const entries = yield* Schema.decodeUnknownEffect(Ballots)(ballots)

  const elections = Map.groupBy(
    entries,
    (entry) => `${entry.geo} ${entry.kind} ${entry.election_date}`,
  )

  return [...elections.values()].flatMap((rounds): Array<ElectionRecord> => {
    const [first] = rounds

    const country = fromGeo.get(first?.geo ?? "")

    const last = rounds
      .map((round) => round.date)
      .toSorted()
      .at(-1)

    return first === undefined || country === undefined || !members.has(country)
      ? []
      : [
          {
            country,
            ballot: first.kind,
            date: first.election_date,
            lastRound: last === undefined || last === first.election_date ? null : last,
            url: first.url,
            retrievedAt: DateTime.makeUnsafe(first.retrieved),
          },
        ]
  })
})

// Every failure, of the transport, the file or a row, is the publisher's.
const unavailable =
  (publisher: Publisher) =>
  <A, E>(records: Effect.Effect<A, E>) =>
    records.pipe(
      Effect.tapError((cause) => Effect.logWarning("Archive failed", publisher, cause)),
      Effect.mapError((cause) => new ArchiveUnavailable({ publisher, cause })),
    )

export class Archives extends Context.Service<Archives, Interface>()("@openfacts/server/Archives") {
  static readonly layer = Layer.effect(
    Archives,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({ schedule: Schedule.exponential("1 second"), times: 2 }),
      )

      const text = (url: string) =>
        client.get(url).pipe(
          Effect.flatMap((response) => response.text),
          Effect.timeout("1 minute"),
        )

      // The one file of a ZIP archive the publisher ships its CSV in.
      const unzipped = (url: string, file: string) =>
        client.get(url).pipe(
          Effect.flatMap((response) => response.arrayBuffer),
          Effect.timeout("1 minute"),
          Effect.flatMap((buffer) => {
            const bytes = unzipSync(new Uint8Array(buffer), {
              filter: (entry) => entry.name === file,
            })[file]

            return bytes === undefined
              ? Effect.fail(`${url} holds no ${file}`)
              : Effect.succeed(new TextDecoder().decode(bytes))
          }),
        )

      const fetchedGovernments = (publisher: Publisher) =>
        DateTime.now.pipe(
          Effect.flatMap((retrievedAt) =>
            Match.value(publisher).pipe(
              Match.when("PPEG", () =>
                unzipped(ppeg.governments.url, ppeg.governments.file).pipe(
                  Effect.flatMap((csv) => ppegGovernments(csv, retrievedAt)),
                ),
              ),
              Match.when("ParlGov", () =>
                Effect.all(
                  {
                    countries: text(parlgov.countries),
                    cabinets: text(parlgov.cabinets),
                    members: text(parlgov.members),
                    parties: text(parlgov.parties),
                  },
                  { concurrency: "unbounded" },
                ).pipe(Effect.flatMap((files) => parlgovGovernments(files, retrievedAt))),
              ),
              Match.when("Official", () => officialGovernments()),
              Match.exhaustive,
            ),
          ),
        )

      const fetchedElections = (publisher: Publisher) =>
        DateTime.now.pipe(
          Effect.flatMap((retrievedAt) =>
            Match.value(publisher).pipe(
              Match.when("PPEG", () =>
                Effect.all(
                  {
                    parliaments: unzipped(ppeg.parliaments.url, ppeg.parliaments.file),
                    presidents: unzipped(ppeg.presidents.url, ppeg.presidents.file),
                  },
                  { concurrency: "unbounded" },
                ).pipe(Effect.flatMap((files) => ppegElections(files, retrievedAt))),
              ),
              Match.when("ParlGov", () =>
                text(parlgov.elections).pipe(
                  Effect.flatMap((csv) => parlgovElections(csv, retrievedAt)),
                ),
              ),
              Match.when("Official", () => officialElections()),
              Match.exhaustive,
            ),
          ),
        )

      const governments = Effect.fn("Archives.governments")(function* (publisher: Publisher) {
        return yield* fetchedGovernments(publisher).pipe(unavailable(publisher))
      })

      const elections = Effect.fn("Archives.elections")(function* (publisher: Publisher) {
        return yield* fetchedElections(publisher).pipe(unavailable(publisher))
      })

      return Archives.of({ governments, elections })
    }),
  )
}
