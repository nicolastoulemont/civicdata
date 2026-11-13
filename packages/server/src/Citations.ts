import { type Cited, citeLink, nameOf } from "@repo/domain"
import { Option } from "effect"

// A citation as the model writes it: a record's id in double brackets,
// "[[event:financial-crisis]]".
const citation = /\[\[\s*([^\]\s]+)\s*\]\]/g

// A name as Markdown link text: brackets and backslashes escaped.
const escaped = (name: string) => name.replaceAll(/[\\[\]]/g, (character) => `\\${character}`)

// What the model wrote, as people read it: each cited record as a link
// named after it, "[Mariano Rajoy](cite:0)", to its place in `cites`. None
// when it cites a record the agent did not look up, whose name it cannot
// show.
export const cite = (
  written: string,
  records: ReadonlyMap<string, Cited>,
): Option.Option<{ readonly text: string; readonly cites: ReadonlyArray<Cited> }> => {
  const cites: Array<Cited> = []
  let unknown = false

  const text = written.replaceAll(citation, (_, id: string) => {
    const record = records.get(id)

    if (record === undefined) {
      unknown = true

      return ""
    }

    cites.push(record)

    return `[${escaped(nameOf(record))}](${citeLink(cites.length - 1)})`
  })

  return unknown ? Option.none() : Option.some({ text, cites })
}
