// PMC's address for an article's PDF, for a PubMed Central copy OpenAlex
// lists without one. The gather fetches the bucket's copy instead.
export const pdfOf = (pmcid: string) => `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/pdf/`
