import { decodeHTML } from "entities"

// Tags that start or end a paragraph.
const block = /<\/?(?:p|div|br|hr|li|ul|ol|h[1-6]|table|tr|blockquote)\b[^>]*>/gi

// What a page never shows: a document's head, scripts and styles.
const hidden = /<(head|script|style|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

const tag = /<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi

// A source's description as plain text: its paragraphs, each on its own and
// separated by a blank line, with whitespace collapsed inside each and no
// tags or entities. Eurostat and the OECD write HTML; the World Bank writes
// text that sometimes holds a tag. Tags are dropped, never rendered, and
// their line breaks count as spaces, as in HTML.
export const plain = (html: string) =>
  html
    .replace(hidden, "")
    .split(block)
    .map((paragraph) =>
      decodeHTML(paragraph.replace(/<\/?t[dh]\b[^>]*>/gi, " ").replace(tag, ""))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((paragraph) => paragraph !== "")
    .join("\n\n")
