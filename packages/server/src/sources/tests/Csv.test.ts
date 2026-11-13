import { describe, expect, it } from "vitest"

import { records } from "../sdmx/utils/records.ts"

describe("records", () => {
  it("reads quoted fields that hold commas, quotes and line breaks", () => {
    const csv = 'REF_AREA,COMMENT\r\nFRA,"en:""<p>One, two</p>\r\n<p>Three</p>"""\r\nIRL,\r\n'

    expect(records(csv).map((record) => Object.fromEntries(record))).toEqual([
      { REF_AREA: "FRA", COMMENT: 'en:"<p>One, two</p>\r\n<p>Three</p>"' },
      { REF_AREA: "IRL", COMMENT: "" },
    ])
  })
})
