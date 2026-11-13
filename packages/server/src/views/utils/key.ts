import type { Observation } from "../transforms.types.ts"

export const key = (observation: Observation) => `${observation.country}:${observation.year}`
