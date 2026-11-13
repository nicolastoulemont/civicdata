// A reference list cites titles that share a query's words without being
// about them. It reads as dense citations: author initials, years followed
// by a title, volumes with issues, page numbers and DOIs. Measured on the 502
// labelled passages of the corpus fixture in src/tests/fixtures/papers, this
// finds 34 of the 42 reference passages and 6 of the 460 others, mostly
// tables and title pages.
const citations = [
  /\b\p{Lu}[\p{L}'’-]+,? (?:\p{Lu}\.? ?){1,3}(?:,|and\b|\(|&)/gu,
  /(?:\(\d{4}[a-z]?\)|\b\d{4}[a-z]?)\.?\s+[‘“"]?\p{Lu}/gu,
  /\b\d+\s?\(\d+\)/g,
  /\bpp?\.\s?\d|doi\.org|\bdoi:/g,
]

export const listsReferences = (text: string) => {
  const found = citations.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0)

  return found >= 3 && found / text.split(/\s+/).length >= 0.04
}
