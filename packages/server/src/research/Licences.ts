import { Clock, Context, Effect, Layer, Option } from "effect"
import { HttpClient } from "effect/http"

import { fingerprint } from "../utils/fingerprint.ts"
import { type Copy, Evidence, PaperUnavailable } from "./archive.schemas.ts"
import { PageCheck } from "./Licences.schemas.ts"
import { bodyOf } from "./utils/bodyOf.ts"
import { briefOf } from "./utils/briefOf.ts"
import { handleOf } from "./utils/handleOf.ts"
import { metaOf } from "./utils/html.ts"
import { licenceOf } from "./utils/licenceOf.ts"
import { supported } from "./utils/supported.ts"

// Read item-level metadata only. A footer licence, another item's licence,
// or a licence attached to another PDF does not identify this copy.
const itemOf = (html: string, options: { copy: Copy; url: string }) => {
  const { copy, url } = options
  const address = new URL(url)

  if (address.hostname !== "www.econstor.eu" || !address.pathname.startsWith("/handle/10419/"))
    return Option.none()
  const record = handleOf(copy.id)

  if (record === undefined || record !== handleOf(url)) return Option.none()
  const metadata = metaOf(html)

  const values = (name: string) =>
    metadata.filter((tag) => tag.name === name).map((tag) => tag.content)

  if (!values("dc.identifier").some((value) => handleOf(value) === record)) return Option.none()

  if (!values("citation_pdf_url").includes(copy.pdf_url)) return Option.none()

  return Option.some({ rights: values("dc.rights"), record })
}

const permission = (rights: ReadonlyArray<string>) => {
  const urls = rights.filter((value) => /^https?:\/\/creativecommons\.org\//i.test(value))
  const licences = urls.flatMap((value) => Option.toArray(licenceOf(value)))

  if (urls.length !== licences.length || new Set(licences).size > 1) return "Denied"

  return licences[0] ?? "Unknown"
}

interface Interface {
  readonly forCopy: (copy: Copy) => Effect.Effect<typeof PageCheck.Type, PaperUnavailable>
}

export class Licences extends Context.Service<Licences, Interface>()("papers/Licences") {
  static readonly layer = Layer.effect(
    Licences,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

      const forCopy = Effect.fn("Licences.forCopy")(
        function* (copy: Copy) {
          if (!supported(copy)) return PageCheck.cases.Unknown.make({})
          const response = yield* client.get(copy.landing_page_url)
          const url = response.url || copy.landing_page_url
          const html = new TextDecoder().decode(yield* bodyOf(response, 2 * 1024 * 1024))
          const found = itemOf(html, { copy, url })

          if (Option.isNone(found)) return PageCheck.cases.Unknown.make({})
          const licence = permission(found.value.rights)

          if (licence === "Denied") return PageCheck.cases.Denied.make({})

          if (licence === "Unknown") return PageCheck.cases.Unknown.make({})

          return PageCheck.cases.Allowed.make({
            evidence: Evidence.cases.Page.make({
              record: found.value.record,
              licence,
              url,
              pdf: copy.pdf_url,
              sha256: yield* fingerprint(html),
              retrievedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            }),
          })
        },
        Effect.timeout("10 seconds"),
        Effect.mapError(
          (cause) => new PaperUnavailable({ operation: "licence-page", cause: briefOf(cause) }),
        ),
      )

      return Licences.of({ forCopy })
    }),
  )
}
