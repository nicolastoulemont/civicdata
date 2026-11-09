import { countries, Country, Day, members, Party, Publisher } from "@civicdata/domain"
import { Context, DateTime, Effect, Layer, Match, Schedule, Schema } from "effect"
import { HttpClient } from "effect/http"
import { unzipSync } from "fflate"

import { geo } from "./geo.ts"
import east from "./official/government-updates-east.json"
import west from "./official/government-updates-west.json"
import { table } from "./Table.ts"

// One government as its publisher records it: when it started, who headed
// it, and its governing parties, the head's party first. `until` is the day
// the publisher's records end, for a government still in office then; the
// sources record no other ends.
export const Recorded = Schema.Struct({
  country: Country,
  head: Schema.NonEmptyString,
  parties: Schema.Array(Party),
  start: Day,
  until: Schema.NullOr(Day),
  url: Schema.NonEmptyString,
  retrievedAt: Schema.DateTimeUtc,
})

interface Recorded extends Schema.Schema.Type<typeof Recorded> {}

// A publisher's records could not be fetched, or did not decode.
export class ArchiveUnavailable extends Schema.TaggedError<
  ArchiveUnavailable,
  { readonly brand: unique symbol }
>()("ArchiveUnavailable", { publisher: Publisher, cause: Schema.Defect() }) {}

interface Interface {
  // Every government a publisher records for the EU and OECD members.
  readonly governments: (
    publisher: Publisher,
  ) => Effect.Effect<ReadonlyArray<Recorded>, ArchiveUnavailable>
}

const isCountry = Schema.is(Country)

const member = (code: string | undefined) => isCountry(code) && members.has(code)

// PPEG 2025v1 (WZB Berlin), CC0 1.0: one row per party and cabinet, the
// cabinet named by its inauguration day and prime minister. Its codebook
// (https://ppeg.wzb.eu/www/codebook_ppeg_gov_2025v1.pdf) defines a new cabinet
// by a change of prime minister, of party composition, or an election.
const ppeg = {
  url: "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip",
  file: "ppeg_gov_2025v1.csv",
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
    { recorded: Omit<Recorded, "parties">; lead: Array<Party>; rest: Array<Party> }
  >()

  for (const row of decoded) {
    const key = `${row.iso3c} ${row.idate}`

    const cabinet = cabinets.get(key) ?? {
      recorded: {
        country: row.iso3c,
        head: personal(row.pm),
        start: row.idate,
        until: row.rft === "Notappl" ? ppeg.cutoff : null,
        url: ppeg.url,
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
      const party = { name: row.pname_en, abbreviation: initials(row.pinitials) }

      if (row.pm_party === "yes") cabinet.lead.push(party)
      else cabinet.rest.push(party)
    }

    cabinets.set(key, cabinet)
  }

  return [...cabinets.values()].map(({ recorded, lead, rest }): Recorded =>
    Object.assign({ parties: [...lead, ...rest] }, recorded),
  )
})

// ParlGov (Döring and Manow), CC0 1.0: cabinets named after their head, e.g.
// "Rajoy II", with their parties in separate tables.
const parlgov = {
  countries: "https://parlgov.fly.dev/data-csv/data_country/",
  cabinets: "https://parlgov.fly.dev/data-csv/data_cabinet/",
  members: "https://parlgov.fly.dev/data-csv/view_cabinet/",
  parties: "https://parlgov.fly.dev/data-csv/view_party/",
}

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
            parties: formation.parties.map((name) => ({ name, abbreviation: null })),
            start: formation.start,
            until: null,
            url: formation.sources[0].url,
            retrievedAt: DateTime.makeUnsafe(survey.checkedAt),
          }))
    }),
  )
})

export class Archives extends Context.Service<Archives, Interface>()("@civicdata/server/Archives") {
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

      const fetched = (publisher: Publisher) =>
        DateTime.now.pipe(
          Effect.flatMap((retrievedAt) =>
            Match.value(publisher).pipe(
              Match.when("PPEG", () =>
                unzipped(ppeg.url, ppeg.file).pipe(
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

      const governments = Effect.fn("Archives.governments")(function* (publisher: Publisher) {
        return yield* fetched(publisher).pipe(
          Effect.tapError((cause) => Effect.logWarning("Archive failed", publisher, cause)),
          Effect.mapError((cause) => new ArchiveUnavailable({ publisher, cause })),
        )
      })

      return Archives.of({ governments })
    }),
  )
}
