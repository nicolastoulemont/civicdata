import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"

import { licenceOf } from "../utils/licenceOf.ts"

describe("licenceOf", () => {
  it("reads CC BY, its IGO and country versions, and the public-domain tools", () => {
    expect(
      [
        "https://creativecommons.org/licenses/by/4.0/",
        "http://creativecommons.org/licenses/by/3.0/igo",
        "https://creativecommons.org/licenses/by/3.0/de/",
        "https://creativecommons.org/licenses/by/2.0/uk/",
        "https://creativecommons.org/licenses/by/2.5/scotland/",
        "https://creativecommons.org/licenses/by/2.1/jp/",
        "https://creativecommons.org/publicdomain/zero/1.0/",
      ].map((url) => Option.getOrNull(licenceOf(url))),
    ).toEqual([
      "https://creativecommons.org/licenses/by/4.0/",
      "https://creativecommons.org/licenses/by/3.0/igo/",
      "https://creativecommons.org/licenses/by/3.0/de/",
      "https://creativecommons.org/licenses/by/2.0/uk/",
      "https://creativecommons.org/licenses/by/2.5/scotland/",
      "https://creativecommons.org/licenses/by/2.1/jp/",
      "https://creativecommons.org/publicdomain/zero/1.0/",
    ])
  })

  it("rejects NC, ND and SA, and versions Creative Commons never adapted", () => {
    expect(
      [
        "https://creativecommons.org/licenses/by-nc/3.0/igo/",
        "https://creativecommons.org/licenses/by-sa/3.0/de/",
        "https://creativecommons.org/licenses/by-nd/4.0/",
        "https://creativecommons.org/licenses/by/4.0/igo/",
        "https://creativecommons.org/licenses/by/4.0/de/",
        "https://creativecommons.org/licenses/by/2.0/igo/",
        "https://creativecommons.org/licenses/by/3.0/uk/",
        "https://creativecommons.org/licenses/by/3.0/xx/",
        "https://creativecommons.org/licenses/by/2.1/",
        "https://creativecommons.org/licenses/by/3.0/de/igo/",
      ].filter((url) => Option.isSome(licenceOf(url))),
    ).toEqual([])
  })
})
