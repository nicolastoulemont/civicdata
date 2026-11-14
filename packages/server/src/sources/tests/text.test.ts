import { describe, expect, it } from "vitest"

import { plain } from "../utils/text.ts"

describe("plain", () => {
  it("drops tags and keeps each paragraph", () => {
    expect(
      plain(
        "<p>Gross domestic product (<strong>GDP</strong>) is defined as the value of all goods.</p>\n<p>Expressed as <a href='https://ec.europa.eu'>percentage change</a>.</p>",
      ),
    ).toBe(
      "Gross domestic product (GDP) is defined as the value of all goods.\n\nExpressed as percentage change.",
    )
  })

  it("decodes entities, named and numeric", () => {
    expect(
      plain("R&amp;D&nbsp;spending &ndash; the OECD&rsquo;s &#39;GERD&#39; &gt; 2&#x25;"),
    ).toBe("R&D spending – the OECD’s 'GERD' > 2%")
  })

  it("keeps an escaped tag as text", () => {
    expect(plain("&lt;p&gt; marks a paragraph")).toBe("<p> marks a paragraph")
  })

  it("breaks paragraphs at line breaks and list items, and joins table cells", () => {
    expect(
      plain(
        "Covers:<br/>men and women<ul><li>aged 15&ndash;64</li><li>in work</li></ul><table><tr><td>EU</td><td>27</td></tr></table>",
      ),
    ).toBe("Covers:\n\nmen and women\n\naged 15–64\n\nin work\n\nEU 27")
  })

  it("leaves out a document's head and styles", () => {
    expect(
      plain(
        "<html><head><title>Note</title><style>p { color: red }</style></head><body><p>Text</p></body></html>",
      ),
    ).toBe("Text")
  })

  it("collapses a source's stray line breaks inside a sentence", () => {
    expect(plain("Taxes are payments made by institutional\n\n\n\n\nunits to government.")).toBe(
      "Taxes are payments made by institutional units to government.",
    )
  })

  it("leaves no tag that removing another one formed", () => {
    expect(plain("<<b></b>script>alert(1)<</b>/script>")).toBe("alert(1)")
  })

  it("leaves a comparison in plain text alone", () => {
    expect(plain("Children aged <5 years and adults >65")).toBe(
      "Children aged <5 years and adults >65",
    )
  })
})
