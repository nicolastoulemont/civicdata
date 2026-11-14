export const metadataUrl = (identity: string) =>
  `https://api.openalex.org/works/${encodeURIComponent(identity.startsWith("https://openalex.org/") ? identity : `https://doi.org/${identity}`)}`
