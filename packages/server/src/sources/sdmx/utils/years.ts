export const years = (found: ReadonlyArray<number>) =>
  found.length === 0 ? null : { first: Math.min(...found), last: Math.max(...found) }
