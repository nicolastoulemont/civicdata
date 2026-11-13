// A real two-page PDF for the paper tests, in workerd and in Node, built
// here so the fixture's text and rights are ours. The tests use the real PDF
// parser; only HTTP is fake.

// Each line of `text` on a line of its own, as a publisher's layout breaks
// a footer.
const stream = (text: string) => {
  const lines = text
    .split("\n")
    .map((line) => `(${line}) Tj`)
    .join(" 0 -14 Td ")

  const content = `BT /F1 12 Tf 40 700 Td ${lines} ET\n`

  return `<< /Length ${content.length} >>\nstream\n${content}endstream`
}

export const pdf = (notice = "https://creativecommons.org/licenses/by/4.0/") => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    stream(`Employment rose in France. ${notice}`),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    stream("The estimate is uncertain."),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]

  let text = "%PDF-1.4\n"
  const offsets = [0]

  for (const [index, object] of objects.entries()) {
    offsets.push(text.length)
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const xref = text.length
  text += `xref\n0 8\n0000000000 65535 f \n`
  text += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  text += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

  return text
}
