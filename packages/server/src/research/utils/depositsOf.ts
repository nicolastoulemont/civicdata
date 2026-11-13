// The deposits a listing names, highest number first. A higher number is
// not always the later deposit, so the gather reads each one's metadata.
export const depositsOf = (listing: string, pmcid: string) =>
  [...listing.matchAll(/<Prefix>(PMC\d+)\.(\d+)\/<\/Prefix>/g)]
    .flatMap(([, id, number]) => (id === pmcid ? [Number(number)] : []))
    .toSorted((a, b) => b - a)
