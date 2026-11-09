import { D1Client } from "@effect/sql-d1"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { strToU8, zipSync } from "fflate"

import { Archives } from "../src/Archives.ts"
import { Step } from "../src/CatalogBuild.ts"
import { Politics } from "../src/Politics.ts"
import { PoliticsBuild } from "../src/PoliticsBuild.ts"
import { http } from "./fakes.ts"
import parlgovCabinets from "./fixtures/parlgov/data_cabinet.csv?raw"
import parlgovCountries from "./fixtures/parlgov/data_country.csv?raw"
import parlgovMembers from "./fixtures/parlgov/view_cabinet.csv?raw"
import parlgovElections from "./fixtures/parlgov/view_election.csv?raw"
import parlgovParties from "./fixtures/parlgov/view_party.csv?raw"
import ppegGovernments from "./fixtures/ppeg/governments.csv?raw"
import ppegParliaments from "./fixtures/ppeg/parliaments.csv?raw"
import ppegPresidents from "./fixtures/ppeg/presidents.csv?raw"

// What each publisher's URLs answer: the recorded files, excerpted from the
// real downloads. Governments: Spain and the Netherlands in PPEG, Spain and
// Canada in ParlGov. Elections: Spain, France and Portugal in PPEG; Spain,
// France and Canada in ParlGov. Tests change it between builds.
export type Files = Record<string, () => Response>

// A PPEG archive: the CSV beside the codebook it ships with.
const zipped = (name: string, csv: string) => () =>
  new Response(
    zipSync({ [`${name}.csv`]: strToU8(csv), [`codebook_${name}.pdf`]: strToU8("%PDF") }),
  )

const text = (csv: string) => () => new Response(csv)

export const recorded = (changes: Files = {}) =>
  ({
    "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip": zipped("ppeg_gov_2025v1", ppegGovernments),
    "https://ppeg.wzb.eu/www/ppeg_parl_2025v1.zip": zipped("ppeg_parl_2025v1", ppegParliaments),
    "https://ppeg.wzb.eu/www/ppeg_pres_2025v1.zip": zipped("ppeg_pres_2025v1", ppegPresidents),
    "https://parlgov.fly.dev/data-csv/data_country/": text(parlgovCountries),
    "https://parlgov.fly.dev/data-csv/data_cabinet/": text(parlgovCabinets),
    "https://parlgov.fly.dev/data-csv/view_cabinet/": text(parlgovMembers),
    "https://parlgov.fly.dev/data-csv/view_party/": text(parlgovParties),
    "https://parlgov.fly.dev/data-csv/view_election/": text(parlgovElections),
    ...changes,
  }) satisfies Files

// A file the publisher no longer serves. Not retried, unlike a 5xx, whose
// retries would wait on the test clock.
export const gone = () => new Response("Not Found", { status: 404 })

const db = env.DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as DB")

// The test Worker's D1 database is shared by every test that uses it.
export const emptyPolitics = () =>
  db.exec(
    "DROP TABLE IF EXISTS governments; DROP TABLE IF EXISTS elections; DROP TABLE IF EXISTS politics_current; DROP TABLE IF EXISTS politics_fingerprint;",
  )

// The records as the version before fingerprints left them.
export const dropFingerprints = Effect.promise(() => db.exec("DROP TABLE politics_fingerprint"))

// The governments as a build stored them before it kept each party's id and
// whether it is the head's.
export const forgetPartyIds = Effect.promise(() =>
  db.exec(
    "UPDATE governments SET parties = (SELECT json_group_array(json_remove(value, '$.id', '$.lead')) FROM json_each(governments.parties))",
  ),
)

// The published generation of each dataset.
export const published = () =>
  Effect.promise(() =>
    db
      .prepare(
        "SELECT records, publisher, generation FROM politics_current ORDER BY records, publisher",
      )
      .all(),
  ).pipe(Effect.map(({ results }) => results))

// The real records, their build and the archives over the test Worker's
// local D1 database, with the publishers faked at the wire.
export const politicsOver = (files: Files) =>
  Layer.mergeAll(Politics.layer, PoliticsBuild.layer).pipe(
    Layer.provide(Archives.layer),
    Layer.provide(http((url) => files[url]?.() ?? new Response("not recorded", { status: 404 }))),
    Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
  )

export const build = (generation: number) =>
  PoliticsBuild.run(generation).pipe(Effect.provide(Step.immediate))
