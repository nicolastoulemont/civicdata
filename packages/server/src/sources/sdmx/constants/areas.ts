import { countries } from "@repo/domain"

import { geo } from "../../constants/geo.ts"
import type { Area } from "../Csv.types.ts"

export const areas: Record<"Eurostat" | "OECD", Area> = {
  Eurostat: {
    column: "geo",
    country: new Map(countries.map(({ code }) => [geo[code], code])),
    // "s" is an estimate Eurostat made itself, rather than the country.
    flag: "OBS_FLAG",
    flags: new Map([
      ["p", "Provisional"],
      ["e", "Estimated"],
      ["s", "Estimated"],
      ["b", "Break"],
    ]),
  },
  OECD: {
    column: "REF_AREA",
    country: new Map(countries.map(({ code }) => [code, code])),
    flag: "OBS_STATUS",
    flags: new Map([
      ["P", "Provisional"],
      ["E", "Estimated"],
      ["B", "Break"],
    ]),
  },
}
