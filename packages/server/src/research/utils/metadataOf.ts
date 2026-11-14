import { bucket } from "../constants/pmc/bucket.ts"

export const metadataOf = (pmcid: string, deposit: number) =>
  `https://${bucket}/${pmcid}.${deposit}/${pmcid}.${deposit}.json`
