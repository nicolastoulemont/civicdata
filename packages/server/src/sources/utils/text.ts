import { decodeHTML } from "entities"

// Tags that start or end a paragraph.
const block = /<\/?(?:p|div|br|hr|li|ul|ol|h[1-6]|table|tr|blockquote)\b[^>]*>/gi

// What a page never shows: a document's head, scripts and styles.
const hidden = /<(head|script|style|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

const tag = /<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi

// Removes every match, again until none is left, so that removing one cannot
// join the text around it into another: "<<b></b>script>".
const removeAll = (text: string, pattern: RegExp, by = "") => {
  let before = text
  let after = text.replace(pattern, by)

  while (after !== before) {
    before = after
    after = before.replace(pattern, by)
  }

  return after
}

// A source's description as plain text: its paragraphs, each on its own and
// separated by a blank line, with whitespace collapsed inside each and no
// tags or entities. Eurostat and the OECD write HTML; the World Bank writes
// text that sometimes holds a tag. Tags are dropped, never rendered, and
// their line breaks count as spaces, as in HTML.
export const plain = (html: string) =>
  removeAll(html, hidden)
    .split(block)
    .map((paragraph) =>
      decodeHTML(removeAll(removeAll(paragraph, /<\/?t[dh]\b[^>]*>/gi, " "), tag))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((paragraph) => paragraph !== "")
    .join("\n\n")
