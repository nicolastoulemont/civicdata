import { Work } from "../archive.schemas.ts"

// A work OpenAlex lists, valid by default: one CC BY copy on a host of its
// own, whose PDF carries a CC BY notice.
export const work = (n: number, delta: Partial<Work> = {}) =>
  Work.make({
    id: `https://openalex.org/W${n}`,
    type: "article",
    authorships: [{ author: { display_name: "Anne Example" } }],
    doi: `https://doi.org/10.1234/w${n}`,
    title: `Minimum wages and employment ${n}`,
    publication_year: 2020,
    updated_date: "2026-11-01T00:00:00",
    is_retracted: false,
    locations: [copy(n)],
    ...delta,
  })

export const copy = (n: number, delta: Partial<Work["locations"][number]> = {}) => ({
  id: `doi:10.1234/w${n}`,
  doi: `https://doi.org/10.1234/w${n}`,
  raw_source_name: "Example University",
  landing_page_url: `https://w${n}.example.org/paper`,
  pdf_url: `https://w${n}.example.org/paper.pdf`,
  license: "cc-by",
  version: "publishedVersion",
  ...delta,
})
