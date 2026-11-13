import { Locale } from "@repo/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { english } from "./messages.ts"

const decodeCatalog = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))

const catalogs = import.meta.glob("./locales/*/*.json", { eager: true, import: "default" })

const catalog = (locale: Locale, namespace: string) =>
  decodeCatalog(catalogs[`./locales/${locale}/${namespace}.json`])

// Translations may reorder words, but these parts are the catalog contract.
const syntax = (message: string) => ({
  placeholders: [...message.matchAll(/{{-?\s*([\w]+)(?:,[^}]*)?\s*}}/g)]
    .map((match) => match[1] ?? "")
    .toSorted(),
  markup: message.match(/<\/?[\w]+\/?>/g) ?? [],
  brand: message.includes("openfacts"),
  leadingSpace: message.startsWith(" "),
  trailingSpace: message.endsWith(" "),
})

for (const namespace of Object.keys(english)) {
  describe(`${namespace} catalogs`, () => {
    const source = catalog("en-US", namespace)
    const keys = Object.keys(source).toSorted()

    it("has English source messages", () => {
      expect(keys.length).toBeGreaterThan(0)
    })

    it.each(Locale.literals)("keeps all messages and placeholders in %s", (locale) => {
      const messages = catalog(locale, namespace)

      expect(Object.keys(messages).toSorted()).toEqual(keys)

      for (const [key, message] of Object.entries(messages)) {
        expect(message.trim(), `${locale}/${namespace}:${key}`).not.toBe("")
        expect(syntax(message), `${locale}/${namespace}:${key}`).toEqual(syntax(source[key] ?? ""))
      }
    })
  })
}
