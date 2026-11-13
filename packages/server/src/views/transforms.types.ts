import type { ResolvedView } from "@repo/domain"

export type Observations = ResolvedView["observations"]

export type Observation = Observations[number]
