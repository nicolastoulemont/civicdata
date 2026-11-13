import { describe, expect, it } from "vitest"

import { readCuracao } from "./curacao.ts"

const document = ({
  zone = "WEST",
  latitude = [0, 0, 1, 0],
  labels = ["<b>FIRST</b>", "<b>FIRST</b>"],
} = {}) => {
  const polygon = [[{ lng: [0, 1, 0, 0], lat: latitude }]]

  const widgets = [
    {
      x: {
        calls: [
          { method: "addPolygons", args: [[polygon, polygon], null, "Population", {}, labels] },
        ],
      },
    },
    { x: { data: [["FIRST"], [zone]] } },
    { items: { value: ["Other widget"] } },
  ]

  return widgets
    .map((widget) => `<script type="application/json">${JSON.stringify(widget)}</script>`)
    .join("")
}

describe("Curaçao census boundaries", () => {
  it("joins the census geozone and drops identical repeated neighbourhood polygons", () => {
    const result = readCuracao(document())

    expect(result.features).toEqual([
      {
        type: "Feature",
        properties: { code: "WEST", name: "WEST", neighbourhood: "FIRST" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [0, 0],
                [1, 0],
                [0, 1],
                [0, 0],
              ],
            ],
          ],
        },
      },
    ])
  })

  it("rejects missing geozone membership", () => {
    expect(() => readCuracao(document({ labels: ["<b>UNKNOWN</b>"] }))).toThrow(
      "Missing Curaçao geozone",
    )
  })

  it("rejects unpaired coordinates", () => {
    expect(() => readCuracao(document({ latitude: [0, 1] }))).toThrow(
      "Unpaired Curaçao coordinates",
    )
  })

  it("rejects a page without the publisher's widgets", () => {
    expect(() => readCuracao("<html></html>")).toThrow("Expected array")
  })
})
