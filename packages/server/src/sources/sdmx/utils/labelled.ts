// A labelled answer (`labels=both`) writes "code: label" in each header and
// dimension cell; an unlabelled one writes the code alone.
export const labelled = (cell: string) => {
  const at = cell.indexOf(": ")

  return at === -1
    ? { code: cell, label: cell }
    : { code: cell.slice(0, at), label: cell.slice(at + 2) }
}
