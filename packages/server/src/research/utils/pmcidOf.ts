// The PMC id of a location OpenAlex harvested from PubMed Central over
// OAI-PMH, whose id ends in the PMC id's number.
export const pmcidOf = (location: string) => {
  const number = location.match(/^pmh:oai:pubmedcentral\.nih\.gov:(\d+)$/)?.[1]

  return number === undefined ? undefined : `PMC${number}`
}
