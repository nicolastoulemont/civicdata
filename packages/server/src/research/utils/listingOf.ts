import { bucket } from "../constants/pmc/bucket.ts"

// The bucket's listing of an article's deposits. PMC numbers each deposit
// of an article (`PMC123.1/`, `PMC123.2/`), and a number may be missing.
export const listingOf = (pmcid: string) => {
  const url = new URL(`https://${bucket}/`)
  url.searchParams.set("list-type", "2")
  url.searchParams.set("prefix", `${pmcid}.`)
  url.searchParams.set("delimiter", "/")

  return url.href
}
