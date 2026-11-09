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
import parlgovParties from "./fixtures/parlgov/view_party.csv?raw"
import ppegGovernments from "./fixtures/ppeg/governments.csv?raw"

// What each publisher's URLs answer: the recorded files, excerpted from the
// real downloads (Spain and the Netherlands in PPEG; Spain and Canada in
// ParlGov). Tests change it between builds.
export type Files = Record<string, () => Response>

const zipped = (name: string, csv: string) => () =>
  new Response(zipSync({ [name]: strToU8(csv), "codebook_ppeg_gov_2025v1.pdf": strToU8("%PDF") }))

const text = (csv: string) => () => new Response(csv)

export const recorded = (changes: Files = {}) =>
  ({
    "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip": zipped("ppeg_gov_2025v1.csv", ppegGovernments),
    "https://parlgov.fly.dev/data-csv/data_country/": text(parlgovCountries),
    "https://parlgov.fly.dev/data-csv/data_cabinet/": text(parlgovCabinets),
    "https://parlgov.fly.dev/data-csv/view_cabinet/": text(parlgovMembers),
    "https://parlgov.fly.dev/data-csv/view_party/": text(parlgovParties),
    ...changes,
  }) satisfies Files

// A file the publisher no longer serves. Not retried, unlike a 5xx, whose
// retries would wait on the test clock.
export const gone = () => new Response("Not Found", { status: 404 })

const db = env.DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as DB")

// The test Worker's D1 database is shared by every test that uses it.
export const emptyPolitics = () =>
  db.exec("DROP TABLE IF EXISTS governments; DROP TABLE IF EXISTS politics_current;")

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
