import { type Cite, type Cited, nameOf } from "@civicdata/domain"
import { Option } from "effect"

// A citation as the model writes it: a record's id in double brackets,
// "[[event:financial-crisis]]".
const citation = /\[\[\s*([^\]\s]+)\s*\]\]/g

// What the model wrote, as people read it: each cited record's name where
// the model wrote its id, and where each name starts. None when it cites a
// record the agent did not look up, whose name it cannot show.
export const cite = (
  written: string,
  records: ReadonlyMap<string, Cited>,
): Option.Option<{ readonly text: string; readonly cites: ReadonlyArray<typeof Cite.Type> }> => {
  let text = ""
  const cites: Array<typeof Cite.Type> = []
  let from = 0

  for (const { 0: whole, 1: id = "", index } of written.matchAll(citation)) {
    const record = records.get(id)

    if (record === undefined) return Option.none()

    text += written.slice(from, index)
    cites.push({ at: text.length, record })
    text += nameOf(record)
    from = index + whole.length
  }

  return Option.some({ text: text + written.slice(from), cites })
}
