import { IndicatorId } from "@repo/domain"

import { archive } from "./archive.ts"

export const indicator = IndicatorId.make(`ILOSTAT:${archive}`)
