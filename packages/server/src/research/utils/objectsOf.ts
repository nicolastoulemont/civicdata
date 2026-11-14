// Where a version's PDF and text live in the PAPERS bucket.
export const objectsOf = (version: string) => ({
  pdf: `version/${version}/paper.pdf`,
  text: `version/${version}/text.json`,
})
