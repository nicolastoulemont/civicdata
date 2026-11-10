// @vitest-environment node
import {
  Change,
  type Country,
  IndicatorId,
  Ranking,
  Ratio,
  Relation,
  Trend,
  Year,
} from "@civicdata/domain"
import { http, HttpResponse } from "msw/http"
import { describe, expect, it } from "vitest"

import { network } from "../../test/network.ts"
import { toQuery } from "../explore/search.ts"
import { respond } from "./respond.ts"

const page = { page: 1, pages: 1, per_page: 50, total: 4 }

// The World Bank's answers, on the wire: two indicators and their values.
const published = {
  "SP.POP.TOTL": {
    name: "Population, total",
    values: { FRA: [67_388_001, 67_571_107], DEU: [83_092_962, 83_160_871] },
  },
  "NY.GDP.PCAP.CD": {
    name: "GDP per capita (current US$)",
    values: { FRA: [40_494, 39_169], DEU: [46_805, 46_773] },
  },
} as const

const worldBank = Object.entries(published).flatMap(([id, { name, values }]) => [
  http.get(`https://api.worldbank.org/v2/indicator/${id}`, () =>
    HttpResponse.json([
      page,
      [{ id, name, sourceNote: "", source: { value: "World Development Indicators" } }],
    ]),
  ),
  http.get(`https://api.worldbank.org/v2/country/:countries/indicator/${id}`, () =>
    HttpResponse.json([
      page,
      Object.entries(values).flatMap(([country, [first, last]]) => [
        { countryiso3code: country, date: "2020", value: last },
        { countryiso3code: country, date: "2019", value: first },
      ]),
    ]),
  ),
])

// Eurostat publishes population too. The Resolver asks it to check the
// World Bank's figures; here it has nothing, so the check is left out.
const eurostat = http.get("https://ec.europa.eu/*", () => new HttpResponse(null, { status: 404 }))

const trend = (
  indicator = "SP.POP.TOTL",
  countries: [Country, ...Array<Country>] = ["FRA", "DEU"],
) =>
  Trend.make({
    indicator: IndicatorId.make(indicator),
    countries,
    from: Year.make(2019),
    to: Year.make(2020),
  })

const both = {
  indicator: IndicatorId.make("SP.POP.TOTL"),
  countries: ["FRA", "DEU"] as const,
}

const get = (query: string) => respond(new Request(`http://localhost/explore.png${query}`))

// The PNG's width, height and inflated pixel rows, read back from its chunks.
const decode = async (bytes: Uint8Array<ArrayBuffer>) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const chunks = new Map<string, Uint8Array<ArrayBuffer>>()

  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at)

    chunks.set(
      new TextDecoder().decode(bytes.subarray(at + 4, at + 8)),
      bytes.subarray(at + 8, at + 8 + length),
    )
    at += length + 12
  }

  const idat = chunks.get("IDAT") ?? new Uint8Array(0)

  const rows = await new Response(
    new Blob([idat]).stream().pipeThrough(new DecompressionStream("deflate")),
  ).arrayBuffer()

  const header = new DataView((chunks.get("IHDR") ?? new Uint8Array(8)).slice().buffer)

  return { width: header.getUint32(0), height: header.getUint32(4), rows: rows.byteLength }
}

describe("GET /explore.png", () => {
  it("draws the card for the chart at the same link", async () => {
    network.use(...worldBank, eurostat)

    const response = await get(toQuery(trend()))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    // Every row holds a filter byte and three bytes, red, green and blue, per pixel.
    expect(await decode(new Uint8Array(await response.arrayBuffer()))).toEqual({
      width: 600,
      height: 315,
      rows: (1 + 600 * 3) * 315,
    })
  })

  it.each([
    ["a ranking", Ranking.make({ ...both, year: Year.make(2020) })],
    ["a map", Ranking.make({ ...both, year: Year.make(2020), as: "Map" })],
    ["a change", Change.make({ ...both, from: Year.make(2019), to: Year.make(2020) })],
    [
      "a ratio",
      Trend.make({
        ...both,
        from: Year.make(2019),
        to: Year.make(2020),
        transform: Ratio.make({ per: IndicatorId.make("NY.GDP.PCAP.CD") }),
      }),
    ],
    [
      "a relation",
      Relation.make({
        ...both,
        against: IndicatorId.make("NY.GDP.PCAP.CD"),
        year: Year.make(2020),
      }),
    ],
  ])("draws the card for %s", async (_, view) => {
    network.use(...worldBank, eurostat)

    const response = await get(toQuery(view))

    expect(response.status).toBe(200)
    expect((await decode(new Uint8Array(await response.arrayBuffer()))).width).toBe(600)
  })

  it("is missing for a link that describes no chart", async () => {
    expect(
      (await get("?chart=trend&indicator=SP.POP.TOTL&countries=ZZZ&from=2019&to=2020")).status,
    ).toBe(404)
  })

  it("is missing for an indicator the World Bank does not have", async () => {
    network.use(
      http.get("https://api.worldbank.org/v2/indicator/NOT.REAL", () =>
        HttpResponse.json([
          {
            message: [
              {
                id: "120",
                key: "Invalid value",
                value: "The provided parameter value is not valid",
              },
            ],
          },
        ]),
      ),
      http.get("https://api.worldbank.org/v2/country/:countries/indicator/NOT.REAL", () =>
        HttpResponse.json([
          {
            message: [
              {
                id: "120",
                key: "Invalid value",
                value: "The provided parameter value is not valid",
              },
            ],
          },
        ]),
      ),
    )

    expect((await get(toQuery(trend("NOT.REAL")))).status).toBe(404)
  })

  it("fails with 502 when the World Bank sends what it cannot read", async () => {
    network.use(
      http.get("https://api.worldbank.org/*", () => HttpResponse.text("<html>Maintenance</html>")),
      eurostat,
    )

    expect((await get(toQuery(trend()))).status).toBe(502)
  })
})
