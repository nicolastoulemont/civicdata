// PubMed Central's copies, as PMC's article datasets on AWS serve them
// (https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/): a world-readable S3 bucket
// NCBI keeps for scripts, with no login. PMC's own article pages answer a
// script with a proof-of-work challenge, which the gather does not solve.
import { Schema } from "effect"

import type { Copy } from "./archive.ts"

export const bucket = "pmc-oa-opendata.s3.amazonaws.com"

// A PubMed Central article as the gather asks the bucket for it: its PMC id,
// and whether the copy is the author's accepted manuscript or the article
// itself.
export interface Article {
  readonly pmcid: string
  readonly manuscript: boolean
}

// The PMC id of a location OpenAlex harvested from PubMed Central over
// OAI-PMH, whose id ends in the PMC id's number.
export const pmcidOf = (location: string) => {
  const number = location.match(/^pmh:oai:pubmedcentral\.nih\.gov:(\d+)$/)?.[1]

  return number === undefined ? undefined : `PMC${number}`
}

// The article of a PubMed Central copy.
export const articleOf = (copy: Copy): Article | undefined => {
  const pmcid = pmcidOf(copy.id)

  return pmcid === undefined ? undefined : { pmcid, manuscript: copy.version === "acceptedVersion" }
}

// PMC's address for an article's PDF, for a PubMed Central copy OpenAlex
// lists without one. The gather fetches the bucket's copy instead.
export const pdfOf = (pmcid: string) => `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/pdf/`

// The bucket's listing of an article's deposits. PMC numbers each deposit
// of an article (`PMC123.1/`, `PMC123.2/`), and a number may be missing.
export const listingOf = (pmcid: string) => {
  const url = new URL(`https://${bucket}/`)
  url.searchParams.set("list-type", "2")
  url.searchParams.set("prefix", `${pmcid}.`)
  url.searchParams.set("delimiter", "/")

  return url.href
}

// The deposits a listing names, highest number first. A higher number is
// not always the later deposit, so the gather reads each one's metadata.
export const depositsOf = (listing: string, pmcid: string) =>
  [...listing.matchAll(/<Prefix>(PMC\d+)\.(\d+)\/<\/Prefix>/g)]
    .flatMap(([, id, number]) => (id === pmcid ? [Number(number)] : []))
    .toSorted((a, b) => b - a)

export const metadataOf = (pmcid: string, deposit: number) =>
  `https://${bucket}/${pmcid}.${deposit}/${pmcid}.${deposit}.json`

// A deposit's metadata: whether it is an author manuscript, and its PDF,
// which a deposit may lack.
export const Deposit = Schema.Struct({
  is_manuscript: Schema.Boolean,
  pdf_url: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^s3:\/\/pmc-oa-opendata\/PMC\d+\.\d+\/[^?\s]+\.pdf/)),
  ),
})

// The HTTPS address of a deposit's PDF, without the checksum its S3 URL
// carries, when the deposit is the one the copy names: a manuscript for an
// accepted version, the article otherwise.
export const pdfUrlOf = (deposit: typeof Deposit.Type, article: Article) =>
  deposit.pdf_url === null || deposit.is_manuscript !== article.manuscript
    ? undefined
    : `https://${bucket}/${deposit.pdf_url.slice("s3://pmc-oa-opendata/".length).split("?")[0]}`
