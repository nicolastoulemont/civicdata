import { Locale } from "@civicdata/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { resources } from "./messages.ts"

const decodeCatalog = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))

// Translations may reorder words, but these parts are the catalog contract.
const syntax = (message: string) => ({
  placeholders: [...message.matchAll(/{{-?\s*([\w]+)(?:,[^}]*)?\s*}}/g)]
    .map((match) => match[1] ?? "")
    .toSorted(),
  markup: message.match(/<\/?[\w]+\/?>/g) ?? [],
  brand: message.includes("civicdata"),
  leadingSpace: message.startsWith(" "),
  trailingSpace: message.endsWith(" "),
})

for (const namespace of ["common", "settings", "home", "conversation", "explore"] as const) {
  describe(`${namespace} catalogs`, () => {
    const source = decodeCatalog(resources["en-US"][namespace])
    const keys = Object.keys(source).toSorted()

    it("has English source messages", () => {
      expect(keys.length).toBeGreaterThan(0)
    })

    it.each(Locale.literals)("keeps all messages and placeholders in %s", (locale) => {
      const catalog = decodeCatalog(resources[locale][namespace])

      expect(Object.keys(catalog).toSorted()).toEqual(keys)

      for (const [key, message] of Object.entries(catalog)) {
        expect(message.trim(), `${locale}/${namespace}:${key}`).not.toBe("")
        expect(syntax(message), `${locale}/${namespace}:${key}`).toEqual(syntax(source[key] ?? ""))
      }
    })
  })
}
