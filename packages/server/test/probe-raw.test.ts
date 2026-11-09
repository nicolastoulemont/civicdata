import { expect, it } from "@effect/vitest"

import cabinets from "./fixtures/parlgov/data_cabinet.csv?raw"
import countries from "./fixtures/parlgov/data_country.csv?raw"
import members from "./fixtures/parlgov/view_cabinet.csv?raw"
import parties from "./fixtures/parlgov/view_party.csv?raw"
import governments from "./fixtures/ppeg/governments.csv?raw"

it("probe: raw fixtures load", () => {
  expect(
    [cabinets, countries, members, parties, governments].every((text) => text.length > 0),
  ).toBe(true)
})
