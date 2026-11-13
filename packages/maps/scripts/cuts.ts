import { Schema } from "effect"
import { difference, intersection } from "polyclip-ts"

import { geometry } from "./lands.ts"

export const cut = Schema.Struct({
  from: Schema.NonEmptyString,
  remove: Schema.NonEmptyArray(Schema.NonEmptyString),
})

interface Part {
  readonly geometry: typeof geometry.Type
  readonly properties: { readonly code: string }
}

// Subtract a sourced child or disputed area from its enclosing polygon.
// This changes no boundary line and keeps the source features in the snapshot.
export const cutBoundaries = <A extends Part>(
  features: ReadonlyArray<A>,
  cuts: ReadonlyArray<typeof cut.Type>,
) => {
  let parts = features

  for (const operation of cuts) {
    if (!parts.some((part) => part.properties.code === operation.from))
      throw new Error(`Missing cut parent ${operation.from}`)

    const removed = operation.remove.map((code) => {
      const part = parts.find((candidate) => candidate.properties.code === code)

      if (part === undefined) throw new Error(`Missing cut boundary ${code}`)

      return part.geometry.coordinates
    })

    parts = parts.map((part) =>
      part.properties.code !== operation.from
        ? part
        : {
            ...part,
            geometry: Schema.decodeUnknownSync(geometry)({
              type: "MultiPolygon",
              coordinates: difference(part.geometry.coordinates, ...removed),
            }),
          },
    )
  }

  return parts
}

// A land mask removes coastal water without moving an administrative border.
export const clipBoundaries = <A extends Part>(features: ReadonlyArray<A>, code: string) => {
  const coast = features.find((part) => part.properties.code === code)

  if (coast === undefined) throw new Error(`Missing coast ${code}`)

  return features.flatMap((part) =>
    part === coast
      ? []
      : [
          {
            ...part,
            geometry: Schema.decodeUnknownSync(geometry)({
              type: "MultiPolygon",
              coordinates: intersection(part.geometry.coordinates, coast.geometry.coordinates),
            }),
          },
        ],
  )
}
