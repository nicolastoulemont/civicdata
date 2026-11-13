import { describe, expect, it } from "vitest"

import { clipBoundaries, cutBoundaries } from "./cuts.ts"
import type { geometry } from "./lands.ts"

const square = (code: string, extent: readonly [number, number, number, number]) => {
  const [west, south, east, north] = extent

  const polygon: typeof geometry.Type = {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  }

  return { geometry: polygon, properties: { code } }
}

describe("sourced boundary subtraction", () => {
  it("keeps a child separate without counting its area in the parent", () => {
    const parent = square("parent", [0, 0, 4, 4])
    const child = square("child", [1, 1, 3, 3])
    const result = cutBoundaries([parent, child], [{ from: "parent", remove: ["child"] }])

    expect(result[0]?.geometry).toEqual({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
          [
            [1, 1],
            [1, 3],
            [3, 3],
            [3, 1],
            [1, 1],
          ],
        ],
      ],
    })
    expect(result[1]).toBe(child)
    expect(parent.geometry.type).toBe("Polygon")
  })

  it.each([
    { from: "missing", remove: ["child"] },
    { from: "parent", remove: ["missing"] },
  ] as const)("rejects an absent source boundary", (operation) => {
    expect(() => cutBoundaries([square("parent", [0, 0, 4, 4])], [operation])).toThrow(
      "Missing cut",
    )
  })

  it("rejects an empty division rather than publishing it", () => {
    expect(() =>
      cutBoundaries(
        [square("parent", [0, 0, 4, 4]), square("child", [0, 0, 4, 4])],
        [{ from: "parent", remove: ["child"] }],
      ),
    ).toThrow("Missing key")
  })
})

describe("coastal boundary clipping", () => {
  it("keeps administrative areas on land and removes the mask from the result", () => {
    const result = clipBoundaries(
      [square("village", [0, 0, 4, 4]), square("coast", [1, 1, 3, 3])],
      "coast",
    )

    expect(result).toEqual([
      {
        properties: { code: "village" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [1, 1],
                [3, 1],
                [3, 3],
                [1, 3],
                [1, 1],
              ],
            ],
          ],
        },
      },
    ])
  })

  it("rejects a missing land mask", () => {
    expect(() => clipBoundaries([square("village", [0, 0, 4, 4])], "missing")).toThrow(
      "Missing coast",
    )
  })
})
