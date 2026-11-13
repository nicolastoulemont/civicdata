import { Schema } from "effect"

import { Licence } from "../archive.schemas.ts"

export const licenceOf = (value: string) => {
  const canonical = value
    .trim()
    .replace(/^http:/, "https:")
    .replace(/\/?$/, "/")

  return Schema.decodeOption(Licence)(canonical)
}
