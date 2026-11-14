import { assert, beforeAll, beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"
import { getResolvedPDFJS } from "unpdf"

import { Step } from "../../platform/Step.ts"
import { scansOf } from "../../tests/plans.ts"
import { fingerprint } from "../../utils/fingerprint.ts"
import { Work } from "../archive.schemas.ts"
import { Bucket } from "../Bucket.ts"
import { Outcome, type Topic } from "../Gather.schemas.ts"
import { keyed, paced, run, sources } from "../Gather.ts"
import { type Limits } from "../Gather.types.ts"
import { Held } from "../Papers.schemas.ts"
import { Papers } from "../Papers.ts"
import { PaperId } from "../store.schemas.ts"
import {
  bibliography,
  papersBucket,
  papersDb,
  papersPlanned,
  publish,
  withdrawCopy,
} from "./papers.ts"
import { pdf } from "./pdf.ts"
import { copy, work } from "./works.ts"

// The paper gather inside workerd, against PAPERS_DB and PAPERS, with
// OpenAlex, the publishers and EconStor faked at the HTTP client. The PDFs
// are real and go through the real parser.

// unpdf loads pdf.js on the first parse, which took most of the first test's
// five seconds on CI. Loading it here gives that cost the hook's timeout.
beforeAll(() => getResolvedPDFJS())

beforeEach(() => reset())

const topic: Topic = { area: "labour", query: "minimum wage employment" }

// An EconStor item: its repository copy, whose licence only its item page
// gives, and that page with EconStor's item-level metadata fields.
const item = (handle: number) => ({
  id: `pmh:oai:econstor.eu:10419/${handle}`,
  doi: null,
  raw_source_name: "EconStor",
  landing_page_url: `https://www.econstor.eu/handle/10419/${handle}`,
  pdf_url: `https://www.econstor.eu/bitstream/10419/${handle}/1/paper.pdf`,
  license: null,
  version: "submittedVersion",
})

const itemPage = (handle: number, licence: string) => `
  <meta name="DC.identifier" content="https://hdl.handle.net/10419/${handle}">
  <meta name="citation_pdf_url" content="${item(handle).pdf_url}">
  <meta name="DC.rights" content="https://www.econstor.eu/dspace/Nutzungsbedingungen">
  <meta name="DC.rights" content="${licence}">
`

// A publisher's landing page, served where OpenAlex lists the PDF, that
// names its PDF in a Highwire Press tag.
const landing = (pdfUrl: string) => `<html><head>
  <meta name="citation_title" content="Minimum wages and employment">
  <meta name="citation_pdf_url" content="${pdfUrl}">
</head><body>Download the PDF</body></html>`

// PubMed Central's copy of article `n`, as OpenAlex lists it: a labelled
// repository copy whose PDF URL is PMC's page, which answers a script with a
// proof-of-work challenge.
const central = (n: number, delta: Partial<Work["locations"][number]> = {}) => ({
  id: `pmh:oai:pubmedcentral.nih.gov:${n}`,
  doi: null,
  raw_source_name: "PubMed Central",
  landing_page_url: `https://pmc.ncbi.nlm.nih.gov/articles/PMC${n}/`,
  pdf_url: `https://pmc.ncbi.nlm.nih.gov/articles/PMC${n}/pdf/paper.pdf`,
  license: "cc-by",
  version: "publishedVersion",
  ...delta,
})

const challenge = `<html><head><title>Preparing to download ...</title></head>
  <body><script type="module">window.ncbi.pmc.pow.init("challenge", "4")</script></body></html>`

const bucket = "https://pmc-oa-opendata.s3.amazonaws.com"

// PMC's bucket on AWS, holding article `n`'s deposits by number, each an
// author manuscript or not; PMC's own pages answer with their challenge.
// The bucket's PDFs are the fixture's, as for any URL ending in .pdf.
const pmc =
  (n: number, deposits: ReadonlyArray<{ number: number; manuscript: boolean }>) =>
  (url: string) => {
    const address = new URL(url)

    if (address.host === "pmc.ncbi.nlm.nih.gov") return new Response(challenge)

    if (address.origin !== bucket) return undefined

    if (address.pathname === "/" && address.searchParams.get("prefix") === `PMC${n}.`)
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Prefix>PMC${n}.</Prefix>${deposits
          .map(
            ({ number }) => `<CommonPrefixes><Prefix>PMC${n}.${number}/</Prefix></CommonPrefixes>`,
          )
          .join("")}</ListBucketResult>`,
        { headers: { "content-type": "application/xml" } },
      )

    const deposit = deposits.find(
      ({ number }) => address.pathname === `/PMC${n}.${number}/PMC${n}.${number}.json`,
    )

    return deposit === undefined
      ? undefined
      : Response.json({
          pmcid: `PMC${n}`,
          version: deposit.number,
          is_manuscript: deposit.manuscript,
          license_code: "CC BY",
          pdf_url: `s3://pmc-oa-opendata/PMC${n}.${deposit.number}/PMC${n}.${deposit.number}.pdf?md5=0`,
        })
  }

// A record as OpenAlex sends it: a work, or one without a title, which the
// gather cannot decode.
type Listed = Work | { readonly id: string; readonly title: null }

interface World {
  // The pages each query's search answers, in order.
  readonly searches: Readonly<Record<string, ReadonlyArray<ReadonlyArray<Listed>>>>
  // Answers a request to a publisher, or leaves it to the default: the
  // fixture PDF for a URL ending in .pdf, and 404 otherwise.
  readonly respond?: (url: string) => Response | undefined
}

// OpenAlex and the publishers on the wire. OpenAlex sends a next cursor on
// every page, as it does, and an empty page past the last.
const world = ({ searches, respond = () => undefined }: World) => {
  const requests: Array<{
    readonly url: string
    readonly at: number
    readonly agent: string
    readonly authorization: string | undefined
  }> = []

  // Each work's current record; a search page lists works by id.
  const records = new Map(
    Object.values(searches).flatMap((pages) => pages.flat().map((record) => [record.id, record])),
  )

  let answer = respond

  const openalex = (url: URL) => {
    const filter = url.searchParams.get("filter") ?? ""

    if (filter.startsWith("ids.openalex:")) {
      const ids = filter.slice("ids.openalex:".length).split("|")

      return Response.json({
        meta: {},
        results: ids.flatMap((id) => {
          const record = records.get(`https://openalex.org/${id}`)

          return record === undefined ? [] : [record]
        }),
      })
    }

    const pages = searches[url.searchParams.get("search") ?? ""] ?? []
    const cursor = url.searchParams.get("cursor")
    const index = cursor === "*" ? 0 : Number(cursor)

    return Response.json({
      meta: { next_cursor: String(index + 1) },
      results: (pages[index] ?? []).map(({ id }) => records.get(id)),
    })
  }

  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push({
        url: request.url,
        at: Date.now(),
        agent: request.headers["user-agent"] ?? "",
        authorization: request.headers["authorization"],
      })
      const url = new URL(request.url)

      const response =
        url.host === "api.openalex.org"
          ? openalex(url)
          : (answer(request.url) ??
            (url.pathname.endsWith(".pdf")
              ? new Response(pdf())
              : new Response("Not found", { status: 404 })))

      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )

  return {
    requests,
    // URLs requested from `from` on, in order.
    urls: (from = 0) => requests.slice(from).map(({ url }) => url),
    // OpenAlex's record of a work changes.
    change: (record: Work) => {
      records.set(record.id, record)
    },
    respond: (next: (url: string) => Response | undefined) => {
      answer = next
    },
    http,
  }
}

// The gather's services, as a Workflow provides them, with no pause between
// requests unless a test sets one.
const layerOf = (
  http: Layer.Layer<HttpClient.HttpClient>,
  {
    gap = Duration.zero,
    key = Option.none(),
    db = papersDb,
  }: {
    readonly gap?: Duration.Duration
    readonly key?: Option.Option<Redacted.Redacted>
    readonly db?: Layer.Layer<SqlClient.SqlClient>
  } = {},
) =>
  Layer.mergeAll(
    sources.pipe(
      Layer.provide(paced({ gap, hosts: {} })),
      Layer.provide(keyed(key)),
      Layer.provide(http),
    ),
    db,
    Bucket.binding(papersBucket),
    Step.immediate,
    Papers.layer,
  )

const gather = (limits: Partial<Limits> = {}, topics: ReadonlyArray<Topic> = [topic]) =>
  run({ topics, limits: { pages: 2, size: 10, ...limits } })

const paperOf = (record: Work) => fingerprint(record.id).pipe(Effect.map((id) => PaperId.make(id)))

// What the reader answers for a work's paper: its text, metadata with why,
// or a withdrawal.
const held = (record: Work) =>
  Effect.gen(function* () {
    return yield* (yield* Papers).read(yield* paperOf(record))
  })

const tagOf = (record: Work) =>
  held(record).pipe(
    Effect.map(({ _tag }) => _tag),
    Effect.catch(({ _tag }) => Effect.succeed(_tag)),
  )

// The outcome of each work in a report, by OpenAlex id.
const outcomes = (report: Effect.Success<ReturnType<typeof run>>) =>
  Object.fromEntries(report.works.map(({ work: id, outcome: { _tag } }) => [id, _tag]))

// Every row the store and the ledger hold, and every object of the bucket.
const contents = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const objects = yield* Effect.promise(() => papersBucket.list())

  return {
    paper: yield* sql`SELECT * FROM paper ORDER BY id`,
    copy: yield* sql`SELECT * FROM copy ORDER BY id`,
    version: yield* sql`SELECT * FROM version ORDER BY id`,
    passage: yield* sql`SELECT * FROM passage ORDER BY version, page, part`,
    ledger: yield* sql`SELECT * FROM work_gathered ORDER BY work`,
    objects: objects.objects.map(({ key, etag }) => ({ key, etag })),
  }
})

const ledgerOf = (record: Work) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const [row] = yield* sql`SELECT outcome, attempts FROM work_gathered
      WHERE work = ${record.id}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({ outcome: Schema.fromJsonString(Outcome), attempts: Schema.Int }),
          ),
        ),
      ),
    )

    return row
  })

const pdfs = (urls: ReadonlyArray<string>) => urls.filter((url) => url.endsWith(".pdf"))

const byText = (a: string | null, b: string | null) => String(a).localeCompare(String(b))

// Work `n`, whose copy sits on a host it shares with others.
const shared = (n: number) =>
  work(n, { locations: [copy(n, { pdf_url: `https://a.example.org/${n}.pdf` })] })

// When each request to `host` went, in order.
const times = (
  requests: ReadonlyArray<{ readonly url: string; readonly at: number }>,
  host: string,
) => requests.flatMap(({ url, at }) => (new URL(url).host === host ? [at] : []))

const key = Option.some(Redacted.make("openalex-key"))

const cached = (n: number) => `https://content.openalex.org/works/W${n}.pdf`

// Work `n`, of which OpenAlex caches a PDF, and whose one labelled copy its
// publisher refuses, as MDPI's CDN refuses scripts.
const walled = (n: number) => work(n, { has_content: { pdf: true }, best_oa_location: copy(n) })

const refusing = (n: number) => (url: string) =>
  url === copy(n).pdf_url ? new Response("Access Denied", { status: 403 }) : undefined

// A PDF of `pages` pages with its CC BY notice only on the last, as older
// Springer layouts print it at the end of the article.
const springer = (pages: number) =>
  pdf("", {
    pages,
    last: "Open Access This article is distributed under the terms\nof the Creative Commons Attribution 4.0 International License\n(http://creativecommons.org/licenses/by/4.0/).",
  })

// Work 1, whose one copy's PDF is `body`.
const publishing = (body: string) =>
  world({
    searches: { [topic.query]: [[work(1)]] },
    respond: (url) => (url === copy(1).pdf_url ? new Response(body) : undefined),
  })

describe("the paper gather", () => {
  it.effect("discovers a topic page by page, up to the page limit", () => {
    const place = world({
      searches: {
        [topic.query]: [
          [work(1), { id: "https://openalex.org/W9", title: null }],
          [work(2)],
          [work(3)],
        ],
        "minimum wage": [[work(1), work(4)]],
      },
    })

    return Effect.gen(function* () {
      const report = yield* gather({}, [topic, { area: "labour", query: "minimum wage" }])

      expect(
        place
          .urls()
          .filter((url) => url.includes("search="))
          .map((url) => new URL(url).searchParams.get("cursor")),
      ).toEqual(["*", "1", "*", "1"])
      expect(report.topics).toMatchObject([
        { query: topic.query, found: 2, skipped: 1, wanted: 2, problem: null },
        { query: "minimum wage", found: 2, skipped: 0, wanted: 1, problem: null },
      ])
      expect(outcomes(report)).toEqual({
        [work(1).id]: "Text",
        [work(2).id]: "Text",
        [work(4).id]: "Text",
      })
      expect(pdfs(place.urls()).toSorted(byText)).toEqual([
        copy(1).pdf_url,
        copy(2).pdf_url,
        copy(4).pdf_url,
      ])
      expect(yield* tagOf(work(3))).toBe("PaperMissing")

      const text = yield* held(work(1))

      assert(Held.guards.Text(text), "Expected the paper's text")
      expect(text.paper.study).toEqual({
        title: "Minimum wages and employment 1",
        year: 2020,
        doi: "10.1234/w1",
        authors: ["Anne Example"],
        publisher: "Example University",
        url: work(1).id,
      })
      expect(text.passages).toEqual([
        {
          page: 1,
          part: 0,
          text: "Employment rose in France. https://creativecommons.org/licenses/by/4.0/",
        },
        { page: 2, part: 0, text: "The estimate is uncertain." },
      ])
      expect(text.version.extraction).toBe("unpdf-2.1.0/300-words")
      expect(text.annotation).toBeNull()
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect(
    "admits text only from copies with copy-specific CC BY or public-domain evidence",
    () => {
      const records = {
        licensed: work(1),
        noncommercial: work(2, { locations: [copy(2, { license: "cc-by-nc" })] }),
        unconfirmed: work(3),
        reserved: work(4),
        repository: work(5, { doi: null, locations: [item(5)] }),
        restricted: work(6, { locations: [{ ...item(6), license: "cc-by" }] }),
        retracted: work(7, { is_retracted: true }),
      }

      const pages: globalThis.Record<string, string> = {
        [item(5).landing_page_url]: itemPage(5, "https://creativecommons.org/licenses/by/4.0/"),
        [item(6).landing_page_url]: itemPage(6, "https://creativecommons.org/licenses/by-nc/4.0/"),
      }

      const place = world({
        searches: { [topic.query]: [Object.values(records)] },
        respond: (url) => {
          if (url === copy(3).pdf_url || url === item(5).pdf_url) return new Response(pdf(""))

          if (url === copy(4).pdf_url) return new Response(pdf("All rights reserved."))

          const page = pages[url]

          return page === undefined ? undefined : new Response(page)
        },
      })

      return Effect.gen(function* () {
        const report = yield* gather()

        expect(outcomes(report)).toEqual({
          [records.licensed.id]: "Text",
          [records.noncommercial.id]: "Metadata",
          [records.unconfirmed.id]: "Metadata",
          [records.reserved.id]: "Metadata",
          [records.repository.id]: "Text",
          [records.restricted.id]: "Metadata",
          [records.retracted.id]: "Metadata",
        })

        // A copy without evidence is never downloaded, nor one whose item page
        // gives another licence; one whose PDF denies it keeps no text.
        expect(pdfs(place.urls()).toSorted(byText)).toEqual(
          [copy(1).pdf_url, copy(3).pdf_url, copy(4).pdf_url, item(5).pdf_url].toSorted(byText),
        )

        const repository = yield* held(records.repository)

        assert(Held.guards.Text(repository), "Expected the repository copy's text")
        expect(repository.copy.evidence).toMatchObject([
          {
            record: "10419/5",
            pdf: item(5).pdf_url,
            licence: "https://creativecommons.org/licenses/by/4.0/",
          },
        ])

        for (const record of [
          records.noncommercial,
          records.unconfirmed,
          records.reserved,
          records.restricted,
        ]) {
          const listed = yield* held(record)

          assert(Held.guards.Metadata(listed), "Expected metadata only")
          expect(listed.reason).toBe("no-usable-copy")
        }

        const retracted = yield* held(records.retracted)

        assert(Held.guards.Metadata(retracted), "Expected metadata only")
        expect(retracted.reason).toBe("retracted")

        // Only the two admitted copies' PDF and text sit in the bucket.
        expect((yield* contents).objects).toHaveLength(4)
      }).pipe(Effect.provide(layerOf(place.http)))
    },
  )

  it.effect("fetches no record or PDF and writes nothing when nothing changed", () => {
    const place = world({
      searches: {
        [topic.query]: [[work(1), work(2, { locations: [copy(2, { license: null })] })]],
      },
    })

    return Effect.gen(function* () {
      yield* gather()
      const before = yield* contents
      const from = place.requests.length
      yield* TestClock.adjust(Duration.days(7))

      const report = yield* gather()

      expect(report.works).toEqual([])
      expect(report.topics).toMatchObject([
        { query: topic.query, found: 2, skipped: 0, unchanged: 2, wanted: 0, problem: null },
      ])
      expect(place.urls(from).every((url) => url.includes("search="))).toBe(true)
      expect(yield* contents).toEqual(before)
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("reads the store's rows by index, whatever the store holds", () => {
    const later: Topic = { area: "labour", query: "pension reform employment" }

    const place = world({
      searches: {
        [topic.query]: [[work(1), work(2, { locations: [copy(2, { license: null })] })]],
        [later.query]: [[work(3), work(4, { locations: [] })]],
      },
    })

    const planned = papersPlanned()

    return Effect.gen(function* () {
      yield* gather()

      const report = yield* gather({}, [later]).pipe(
        Effect.provide(layerOf(place.http, { db: planned.layer })),
      )

      expect(outcomes(report)).toEqual({ [work(3).id]: "Text", [work(4).id]: "Metadata" })

      // A scan reads every row of a table: on production's store, a scan of
      // `copy` per metadata-only work read 17 million rows in one run.
      expect(scansOf(yield* planned.plans)).toEqual([])
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("gathers again a work whose record changed, and no other", () => {
    const unlicensed = work(1, { locations: [copy(1, { license: null })] })
    const place = world({ searches: { [topic.query]: [[unlicensed, work(2)]] } })

    return Effect.gen(function* () {
      yield* gather()
      expect(yield* tagOf(unlicensed)).toBe("Metadata")
      const from = place.requests.length

      // A new updated_date alone, as a citation count moves it, is no change.
      place.change(work(2, { updated_date: "2026-11-08T00:00:00" }))
      place.change(work(1, { updated_date: "2026-11-08T00:00:00" }))

      const report = yield* gather()

      expect(outcomes(report)).toEqual({ [work(1).id]: "Text" })
      expect(pdfs(place.urls(from))).toEqual([copy(1).pdf_url])
      expect(yield* tagOf(work(1))).toBe("Text")
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("fails only the work whose PDF host failed, and asks for it alone next time", () => {
    const place = world({ searches: { [topic.query]: [[work(1), work(2)]] } })

    return Effect.gen(function* () {
      place.respond((url) =>
        url === copy(1).pdf_url ? new Response("unavailable", { status: 503 }) : undefined,
      )

      const first = yield* gather()

      expect(outcomes(first)).toEqual({ [work(1).id]: "Failed", [work(2).id]: "Text" })
      expect(first.works[0]?.outcome).toMatchObject({ operation: "download" })
      expect(yield* tagOf(work(1))).toBe("Metadata")
      expect(yield* ledgerOf(work(1))).toMatchObject({ attempts: 1 })

      place.respond(() => undefined)
      const from = place.requests.length
      const second = yield* gather()

      expect(outcomes(second)).toEqual({ [work(1).id]: "Text" })
      expect(pdfs(place.urls(from))).toEqual([copy(1).pdf_url])
      expect(yield* tagOf(work(1))).toBe("Text")
      expect(yield* ledgerOf(work(1))).toMatchObject({ attempts: 0 })
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("stops asking for a failing work at the attempt limit until its record changes", () => {
    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url ? new Response("unavailable", { status: 503 }) : undefined,
    })

    return Effect.gen(function* () {
      yield* gather({ attempts: 2 })
      yield* gather({ attempts: 2 })
      const from = place.requests.length

      expect(yield* ledgerOf(work(1))).toMatchObject({ attempts: 2 })
      expect((yield* gather({ attempts: 2 })).works).toEqual([])
      expect(pdfs(place.urls(from))).toEqual([])

      // A new copy on another host is a new record.
      const moved = work(1, { locations: [copy(11)] })
      place.change(moved)

      expect(outcomes(yield* gather({ attempts: 2 }))).toEqual({ [moved.id]: "Text" })
      expect(yield* ledgerOf(moved)).toMatchObject({ attempts: 0 })
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("never turns a paper whose text the store serves into metadata-only", () => {
    const place = world({ searches: { [topic.query]: [[work(1)]] } })

    return Effect.gen(function* () {
      yield* gather()
      const text = yield* held(work(1))

      assert(Held.guards.Text(text), "Expected the paper's text")

      // OpenAlex no longer lists a licensed copy.
      const unlicensed = work(1, { locations: [copy(1, { license: null })] })
      place.change(unlicensed)
      const refused = yield* gather()

      const outcome = refused.works[0]?.outcome

      assert(outcome !== undefined && Outcome.guards.Refused(outcome), "Expected a refusal")
      expect(outcome.problem).toContain("withdraw its copy first")
      expect(yield* tagOf(work(1))).toBe("Text")
      expect((yield* gather()).works).toEqual([])

      // A withdrawal with its reason lets the record through.
      yield* withdrawCopy({ copy: text.copy.id, reason: "Rights" })
      place.change(work(1, { title: "Minimum wages and employment, revised", locations: [] }))

      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Metadata" })
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("leaves a work a hand-audited copy holds to that copy", () => {
    const place = world({ searches: { [topic.query]: [[work(1)]] } })
    const audited = bibliography({ id: PaperId.make("c".repeat(64)), openalex: work(1).id })

    return Effect.gen(function* () {
      yield* publish({ paper: audited })

      const report = yield* gather()

      expect(report.works[0]?.outcome).toEqual(
        Outcome.cases.Covered.make({ paper: "c".repeat(64) }),
      )
      expect(pdfs(place.urls())).toEqual([])
      expect(yield* tagOf(work(1))).toBe("PaperMissing")
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("reads the reviewed topic file, today's eleven queries first", () => {
    const place = world({ searches: {} })

    return Effect.gen(function* () {
      const report = yield* run({ limits: { pages: 1 } })

      expect(report.topics.slice(0, 11).map(({ query }) => query)).toEqual([
        '"minimum wage" OR "fiscal multipliers" OR "pension reform" OR "democracy economic growth"',
        "minimum wage employment",
        "fiscal multipliers",
        "pension reform employment",
        "democracy economic growth",
        "carbon pricing emissions synthetic control",
        "retirement regression discontinuity",
        "fiscal multipliers",
        "pension reform retirement employment",
        "carbon tax emissions",
        "minimum wage difference differences",
      ])
      expect(
        place
          .urls()
          .filter((url) => new URL(url).searchParams.get("filter")?.includes("S4306401696")),
      ).toHaveLength(5)
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("follows a landing page's PDF tag on its own site and admits the licensed PDF", () => {
    const linked = "https://files.example.org/w1/paper-final.pdf"

    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url ? new Response(landing(linked), { status: 200 }) : undefined,
    })

    return Effect.gen(function* () {
      const report = yield* gather()

      expect(outcomes(report)).toEqual({ [work(1).id]: "Text" })
      expect(place.urls().filter((url) => !url.startsWith("https://api."))).toEqual([
        copy(1).pdf_url,
        linked,
      ])

      const text = yield* held(work(1))

      assert(Held.guards.Text(text), "Expected the linked PDF's text")
      expect(text.version.url).toBe(linked)
      expect(text.copy.evidence).toMatchObject([
        { url: linked, page: 1, licence: "https://creativecommons.org/licenses/by/4.0/" },
      ])
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("never follows a landing page's PDF tag to another site", () => {
    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url
          ? new Response(landing("https://mirror.example.net/paper.pdf"))
          : undefined,
    })

    return Effect.gen(function* () {
      const report = yield* gather()

      expect(report.works[0]?.outcome).toEqual(
        Outcome.cases.Failed.make({
          operation: "download",
          problem: "w1.example.org: Copy did not return a PDF",
        }),
      )
      expect(place.urls().map((url) => new URL(url).host)).not.toContain("mirror.example.net")
      expect(yield* tagOf(work(1))).toBe("Metadata")
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("moves on from a copy its publisher refuses to a repository copy", () => {
    // The publisher's copy comes first and refuses; EconStor's item page
    // gives its own copy's licence.
    const record = work(1, { locations: [copy(1), item(5)] })

    const place = world({
      searches: { [topic.query]: [[record]] },
      respond: (url) => {
        if (url === copy(1).pdf_url) return new Response("Forbidden", { status: 403 })

        return url === item(5).landing_page_url
          ? new Response(itemPage(5, "https://creativecommons.org/licenses/by/4.0/"))
          : undefined
      },
    })

    return Effect.gen(function* () {
      const report = yield* gather()

      expect(outcomes(report)).toEqual({ [record.id]: "Text" })
      expect(place.urls().filter((url) => !url.startsWith("https://api."))).toEqual([
        copy(1).pdf_url,
        item(5).landing_page_url,
        item(5).pdf_url,
      ])

      const text = yield* held(record)

      assert(Held.guards.Text(text), "Expected the repository copy's text")
      expect(text.version.url).toBe(item(5).pdf_url)
      expect(yield* ledgerOf(record)).toMatchObject({ attempts: 0 })
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("fails a work only when every copy worth downloading failed, naming each", () => {
    // OpenAlex lists the publisher's copy first; the labelled repository
    // copy is tried first.
    const repository = copy(2, {
      id: "pmh:oai:europepmc.org:2",
      pdf_url: "https://europepmc.org/articles/PMC2/pdf/paper.pdf",
      version: "acceptedVersion",
    })

    const records = {
      failing: work(2, { locations: [copy(2), repository] }),
      // One copy refuses; the other's PDF gives no licence, which decides.
      decided: work(3, { locations: [copy(3), copy(4, { id: "doi:10.1234/w3-copy" })] }),
    }

    const place = world({
      searches: { [topic.query]: [Object.values(records)] },
      respond: (url) => {
        if (url === repository.pdf_url) return new Response("Not found", { status: 404 })

        if (url === copy(2).pdf_url || url === copy(3).pdf_url)
          return new Response("Forbidden", { status: 403 })

        return url === copy(4).pdf_url ? new Response(pdf("")) : undefined
      },
    })

    return Effect.gen(function* () {
      const report = yield* gather()

      expect(report.works.find(({ work: id }) => id === records.failing.id)?.outcome).toEqual(
        Outcome.cases.Failed.make({
          operation: "download",
          problem: "europepmc.org: HTTP 404; w2.example.org: HTTP 403",
        }),
      )
      expect(
        place.urls().filter((url) => url === repository.pdf_url || url === copy(2).pdf_url),
      ).toEqual([repository.pdf_url, copy(2).pdf_url])
      expect(yield* ledgerOf(records.failing)).toMatchObject({ attempts: 1 })
      expect(yield* tagOf(records.failing)).toBe("Metadata")

      expect(outcomes(report)[records.decided.id]).toBe("Metadata")
      expect(yield* ledgerOf(records.decided)).toMatchObject({ attempts: 0 })
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("names the project's client on every request, OpenAlex and publishers alike", () => {
    const place = world({ searches: { [topic.query]: [[work(1)]] } })

    return Effect.gen(function* () {
      yield* gather()

      expect(new Set(place.requests.map(({ url }) => new URL(url).host))).toEqual(
        new Set(["api.openalex.org", "w1.example.org"]),
      )
      expect(new Set(place.requests.map(({ agent }) => agent))).toEqual(
        new Set(["openfacts-papers/1.0 (+https://openfacts.app)"]),
      )
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.live("paces requests to each host and lets other hosts go meanwhile", () => {
    const place = world({ searches: { [topic.query]: [[shared(1), shared(2), work(3)]] } })

    return Effect.gen(function* () {
      yield* gather({ concurrency: 3 })

      const [first = 0, second = 0] = times(place.requests, "a.example.org")
      const [other = 0] = times(place.requests, "w3.example.org")

      expect(second - first).toBeGreaterThanOrEqual(290)
      expect(other).toBeLessThan(second)
    }).pipe(Effect.provide(layerOf(place.http, { gap: Duration.millis(300) })))
  })

  it.effect("signs OpenAlex's requests with the key, and no publisher's", () => {
    const place = world({ searches: { [topic.query]: [[work(1)]] } })

    return Effect.gen(function* () {
      yield* gather()

      const signed = (host: string) =>
        place.requests.flatMap(({ url, authorization }) =>
          new URL(url).host === host ? [authorization ?? null] : [],
        )

      expect(new Set(signed("api.openalex.org"))).toEqual(new Set(["Bearer openalex-key"]))
      expect(signed("w1.example.org")).toEqual([null])
      expect(place.urls().some((url) => url.includes("openalex-key"))).toBe(false)
    }).pipe(
      Effect.provide(layerOf(place.http, { key: Option.some(Redacted.make("openalex-key")) })),
    )
  })

  it.effect(
    "fetches a PubMed Central copy from PMC's bucket, the deposit its version names",
    () => {
      const record = work(7, { locations: [central(7)] })

      const place = world({
        searches: { [topic.query]: [[record]] },
        respond: pmc(7, [
          { number: 1, manuscript: false },
          { number: 2, manuscript: true },
        ]),
      })

      return Effect.gen(function* () {
        const report = yield* gather()

        expect(outcomes(report)).toEqual({ [record.id]: "Text" })
        expect(place.urls().filter((url) => !url.startsWith("https://api."))).toEqual([
          `${bucket}/?list-type=2&prefix=PMC7.&delimiter=%2F`,
          `${bucket}/PMC7.2/PMC7.2.json`,
          `${bucket}/PMC7.1/PMC7.1.json`,
          `${bucket}/PMC7.1/PMC7.1.pdf`,
        ])

        const text = yield* held(record)

        assert(Held.guards.Text(text), "Expected the bucket's copy's text")
        expect(text.version.url).toBe(`${bucket}/PMC7.1/PMC7.1.pdf`)
        expect(text.copy.evidence).toMatchObject([{ url: `${bucket}/PMC7.1/PMC7.1.pdf`, page: 1 }])
      }).pipe(Effect.provide(layerOf(place.http)))
    },
  )

  it.effect("tries a PubMed Central copy OpenAlex lists without a PDF URL", () => {
    // The publisher refuses scripts, as MDPI does; OpenAlex gives PMC's copy
    // no PDF URL.
    const record = work(8, { locations: [copy(8), central(8, { pdf_url: null })] })

    const place = world({
      searches: { [topic.query]: [[record]] },
      respond: (url) =>
        url === copy(8).pdf_url
          ? new Response("Access Denied", { status: 403 })
          : pmc(8, [{ number: 1, manuscript: false }])(url),
    })

    return Effect.gen(function* () {
      const report = yield* gather()

      expect(outcomes(report)).toEqual({ [record.id]: "Text" })

      const text = yield* held(record)

      assert(Held.guards.Text(text), "Expected PubMed Central's text")
      expect(text.version.url).toBe(`${bucket}/PMC8.1/PMC8.1.pdf`)
      expect(text.copy.location).toMatchObject({
        id: central(8).id,
        pdf_url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8/pdf/",
      })
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("fails a PubMed Central copy PMC's bucket lacks, naming the bucket", () => {
    const record = work(9, { locations: [central(9)] })

    const place = world({ searches: { [topic.query]: [[record]] }, respond: pmc(9, []) })

    return Effect.gen(function* () {
      const report = yield* gather()

      expect(report.works[0]?.outcome).toEqual(
        Outcome.cases.Failed.make({
          operation: "download",
          problem: "pmc-oa-opendata.s3.amazonaws.com: PMC's bucket holds no PDF of this version",
        }),
      )
      expect(place.urls().some((url) => new URL(url).host === "pmc.ncbi.nlm.nih.gov")).toBe(false)
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("reads a licence notice whose URL the layout broke before its version", () => {
    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url
          ? new Response(
              pdf("Attribution (CC BY) license https://\ncreativecommons.org/licenses/by/\n4.0/."),
            )
          : undefined,
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Text" })

      const text = yield* held(work(1))

      assert(Held.guards.Text(text), "Expected the paper's text")
      expect(text.copy.evidence).toMatchObject([
        { page: 1, licence: "https://creativecommons.org/licenses/by/4.0/" },
      ])
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  describe("a notice on the last page", () => {
    it.effect("admits a copy no longer than an article, with evidence on that page", () => {
      const place = publishing(springer(11))

      return Effect.gen(function* () {
        expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Text" })

        const text = yield* held(work(1))

        assert(Held.guards.Text(text), "Expected the paper's text")
        expect(text.copy.evidence).toMatchObject([
          { page: 11, licence: "https://creativecommons.org/licenses/by/4.0/" },
        ])
      }).pipe(Effect.provide(layerOf(place.http)))
    })

    // An excluded copy keeps no reason in the store, so these two read the
    // same: the PDF was read and its copy restricted.
    it.effect("leaves a copy longer than an article unconfirmed", () => {
      const place = publishing(springer(41))

      return Effect.gen(function* () {
        expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Metadata" })
        expect(place.urls()).toContain(copy(1).pdf_url)
        expect((yield* contents).copy).toMatchObject([{ admission: "Restricted" }])
      }).pipe(Effect.provide(layerOf(place.http)))
    })

    it.effect("excludes a copy whose last page reserves all rights", () => {
      const place = publishing(pdf(undefined, { pages: 11, last: "All rights reserved." }))

      return Effect.gen(function* () {
        expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Metadata" })
        expect(place.urls()).toContain(copy(1).pdf_url)
        expect((yield* contents).copy).toMatchObject([{ admission: "Restricted" }])
      }).pipe(Effect.provide(layerOf(place.http)))
    })
  })

  it.effect("admits a CC BY 3.0 IGO notice, and excludes a CC BY-NC 3.0 IGO one", () => {
    const records = { igo: work(1), noncommercial: work(2) }

    const place = world({
      searches: { [topic.query]: [Object.values(records)] },
      respond: (url) => {
        if (url === copy(1).pdf_url)
          return new Response(
            pdf("CC BY 3.0 IGO\nhttps://creativecommons.org/licenses/by/3.0/igo/"),
          )

        if (url === copy(2).pdf_url)
          return new Response(
            pdf("CC BY-NC 3.0 IGO\nhttps://creativecommons.org/licenses/by-nc/3.0/igo/"),
          )

        return undefined
      },
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({
        [records.igo.id]: "Text",
        [records.noncommercial.id]: "Metadata",
      })

      const text = yield* held(records.igo)

      assert(Held.guards.Text(text), "Expected the IGO paper's text")
      expect(text.copy.evidence).toMatchObject([
        { page: 1, licence: "https://creativecommons.org/licenses/by/3.0/igo/" },
      ])
      expect(text.version.extraction).toBe("unpdf-2.1.0/300-words")

      const listed = yield* held(records.noncommercial)

      assert(Held.guards.Metadata(listed), "Expected metadata only")
      expect(listed.reason).toBe("no-usable-copy")
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect(
    "fetches OpenAlex's cached PDF, signed, when every copy worth downloading fails",
    () => {
      const place = world({ searches: { [topic.query]: [[walled(1)]] }, respond: refusing(1) })

      return Effect.gen(function* () {
        expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Text" })
        expect(place.urls().filter((url) => !url.startsWith("https://api."))).toEqual([
          copy(1).pdf_url,
          cached(1),
        ])
        expect(place.requests.find(({ url }) => url === cached(1))?.authorization).toBe(
          "Bearer openalex-key",
        )
        expect(place.urls().some((url) => url.includes("openalex-key"))).toBe(false)

        const text = yield* held(work(1))

        assert(Held.guards.Text(text), "Expected the cached PDF's text")
        expect(text.version.url).toBe(cached(1))
        expect(text.copy.location).toMatchObject({
          id: "openalex:content:W1",
          version: "publishedVersion",
          pdf_url: cached(1),
        })
        expect(text.copy.evidence).toMatchObject([{ url: cached(1), page: 1 }])
      }).pipe(Effect.provide(layerOf(place.http, { key })))
    },
  )

  it.effect("keeps a work as metadata when its cached PDF has no licence notice", () => {
    const place = world({
      searches: { [topic.query]: [[walled(1)]] },
      respond: (url) => (url === cached(1) ? new Response(pdf("")) : refusing(1)(url)),
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Metadata" })
      expect(yield* ledgerOf(work(1))).toMatchObject({
        outcome: { reason: "no-usable-copy" },
        attempts: 0,
      })
    }).pipe(Effect.provide(layerOf(place.http, { key })))
  })

  it.effect("asks for no cached PDF when the copies were excluded on their own evidence", () => {
    const place = world({
      searches: { [topic.query]: [[walled(1)]] },
      respond: (url) => (url === copy(1).pdf_url ? new Response(pdf("")) : undefined),
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Metadata" })
      expect(place.urls()).not.toContain(cached(1))
    }).pipe(Effect.provide(layerOf(place.http, { key })))
  })

  it.effect(
    "leaves works for the next run, with no attempt, once OpenAlex's budget is spent",
    () => {
      const place = world({
        searches: { [topic.query]: [[walled(1), walled(2)]] },
        respond: (url) =>
          url.startsWith("https://content.openalex.org/")
            ? new Response("Insufficient credits", { status: 429 })
            : (refusing(1)(url) ?? refusing(2)(url)),
      })

      return Effect.gen(function* () {
        const first = yield* gather({ concurrency: 1 })

        expect(first.works).toEqual([])
        expect(first.topics).toMatchObject([{ waiting: 2, capped: true }])
        expect(place.urls().filter((url) => url.startsWith("https://content."))).toEqual([
          cached(1),
        ])
        expect(yield* ledgerOf(work(1))).toBeUndefined()

        place.respond((url) => refusing(1)(url) ?? refusing(2)(url))

        expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Text", [work(2).id]: "Text" })
      }).pipe(Effect.provide(layerOf(place.http, { key })))
    },
  )

  it.effect("fetches no more cached PDFs than the run's cap", () => {
    const place = world({
      searches: { [topic.query]: [[walled(1), walled(2)]] },
      respond: (url) => refusing(1)(url) ?? refusing(2)(url),
    })

    return Effect.gen(function* () {
      const report = yield* run({
        topics: [topic],
        limits: { size: 10, concurrency: 1 },
        caps: { cached: 1 },
      })

      expect(outcomes(report)).toEqual({ [work(1).id]: "Text" })
      expect(report.topics).toMatchObject([{ waiting: 1, capped: true }])
      expect(report.fetched).toMatchObject({ cached: 1 })
      expect(report.stopped).toBeNull()
    }).pipe(Effect.provide(layerOf(place.http, { key })))
  })

  it.effect("gathers no stored work again once its record lists a cached PDF", () => {
    const place = world({ searches: { [topic.query]: [[work(1)]] } })

    return Effect.gen(function* () {
      yield* gather()
      place.change(walled(1))

      expect((yield* gather()).works).toEqual([])
    }).pipe(Effect.provide(layerOf(place.http, { key })))
  })

  it.effect("reads an article's CC BY notice beside the CC0 waiver for its data", () => {
    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url
          ? new Response(
              pdf(
                "visit http://creativecommons.org/licenses/by/4.0/.\nThe Creative Commons Public Domain Dedication waiver\n(http://creativecommons.org/publicdomain/zero/1.0/) applies to the data made available in this article.",
              ),
            )
          : undefined,
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Text" })

      const text = yield* held(work(1))

      assert(Held.guards.Text(text), "Expected the article's text")
      expect(text.copy.evidence).toMatchObject([
        { page: 1, licence: "https://creativecommons.org/licenses/by/4.0/" },
      ])
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("excludes a PDF whose CC0 notice is not a waiver for its data", () => {
    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url
          ? new Response(
              pdf(
                "http://creativecommons.org/licenses/by/4.0/\nhttp://creativecommons.org/publicdomain/zero/1.0/",
              ),
            )
          : undefined,
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Metadata" })
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("admits a PDF whose CC BY URL is only a link on its notice", () => {
    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url
          ? new Response(
              pdf("Creative Commons Attribution (CC BY) license.", {
                links: ["https://creativecommons.org/licenses/by/4.0/"],
              }),
            )
          : undefined,
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Text" })

      const text = yield* held(work(1))

      assert(Held.guards.Text(text), "Expected the paper's text")
      expect(text.copy.evidence).toMatchObject([
        { page: 1, licence: "https://creativecommons.org/licenses/by/4.0/" },
      ])
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("excludes a PDF whose notice links a non-commercial licence", () => {
    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url
          ? new Response(
              pdf("Creative Commons Attribution (CC BY-NC) license.", {
                links: ["https://creativecommons.org/licenses/by-nc/4.0/"],
              }),
            )
          : undefined,
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Metadata" })
    }).pipe(Effect.provide(layerOf(place.http)))
  })

  it.effect("reads the CC0 link of a data waiver as the waiver's, not a second licence", () => {
    const place = world({
      searches: { [topic.query]: [[work(1)]] },
      respond: (url) =>
        url === copy(1).pdf_url
          ? new Response(
              pdf(
                "visit http://creativecommons.org/licenses/by/4.0/.\nThe Creative Commons Public Domain Dedication waiver\n(http://creativeco\nmmons.org/publicdomain/zero/1.0/) applies to the data.",
                {
                  links: [
                    "http://creativecommons.org/licenses/by/4.0/",
                    "http://creativecommons.org/publicdomain/zero/1.0/",
                  ],
                },
              ),
            )
          : undefined,
    })

    return Effect.gen(function* () {
      expect(outcomes(yield* gather())).toEqual({ [work(1).id]: "Text" })

      const text = yield* held(work(1))

      assert(Held.guards.Text(text), "Expected the article's text")
      expect(text.copy.evidence).toMatchObject([
        { page: 1, licence: "https://creativecommons.org/licenses/by/4.0/" },
      ])
      expect(text.copy.evidence).toHaveLength(1)
    }).pipe(Effect.provide(layerOf(place.http)))
  })
})
