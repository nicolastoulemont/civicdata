// A PubMed Central article as the gather asks the bucket for it: its PMC id,
// and whether the copy is the author's accepted manuscript or the article
// itself.
export interface Article {
  readonly pmcid: string
  readonly manuscript: boolean
}
