// A real PDF for the paper tests, in workerd and in Node, built here so the
// fixture's text and rights are ours. The tests use the real PDF parser;
// only HTTP is fake.

// Each line of `text` on a line of its own, as a publisher's layout breaks
// a footer, its parentheses escaped as a PDF string needs.
const stream = (text: string) => {
  const lines = text
    .split("\n")
    .map((line) => `(${line.replace(/[()\\]/g, "\\$&")}) Tj`)
    .join(" 0 -14 Td ")

  const content = `BT /F1 12 Tf 40 700 Td ${lines} ET\n`

  return `<< /Length ${content.length} >>\nstream\n${content}endstream`
}

interface PdfOptions {
  // How many pages the PDF has: two by default, and never fewer.
  readonly pages?: number
  // The last page's text. The pages between the first and the last read
  // the same.
  readonly last?: string
  // URLs page 1 links from its text, as a publisher links its licence
  // notice without printing the URL.
  readonly links?: ReadonlyArray<string>
}

// The first page carries `notice` after a line of text, as a publisher's
// cover prints its licence.
export const pdf = (
  notice = "https://creativecommons.org/licenses/by/4.0/",
  { pages = 2, last = "The estimate is uncertain.", links = [] }: PdfOptions = {},
) => {
  const font = 3 + 2 * pages

  const annotations = links.map(
    (url) =>
      `<< /Type /Annot /Subtype /Link /Rect [40 690 300 710] /A << /S /URI /URI (${url}) >> >>`,
  )

  const annots = `/Annots [${annotations.map((_, index) => `${font + 1 + index} 0 R`).join(" ")}]`

  const page = (index: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + 2 * index} 0 R${index === 0 ? ` ${annots}` : ""} >>`

  const texts = [
    `Employment rose in France. ${notice}`,
    ...Array.from({ length: pages - 2 }, () => "The estimate is uncertain."),
    last,
  ]

  const kids = texts.map((_, index) => `${3 + 2 * index} 0 R`).join(" ")

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...texts.flatMap((text, index) => [page(index), stream(text)]),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...annotations,
  ]

  let text = "%PDF-1.4\n"
  const offsets = [0]

  for (const [index, object] of objects.entries()) {
    offsets.push(text.length)
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const size = objects.length + 1
  const xref = text.length
  text += `xref\n0 ${size}\n0000000000 65535 f \n`
  text += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  text += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

  return text
}
