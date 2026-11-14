// Every record of a CSV text, each a map from its header's names to its
// fields. Unlike data answers, reference metadata quotes fields that hold
// commas, quotes and line breaks.
export const records = (text: string): ReadonlyArray<ReadonlyMap<string, string>> => {
  const parsed: Array<Array<string>> = []
  let record: Array<string> = []
  let field = ""
  let quoted = false

  const endField = () => {
    record.push(field)
    field = ""
  }

  const endRecord = () => {
    endField()

    if (record.some((each) => each !== "")) parsed.push(record)

    record = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ",") endField()
    else if (char === "\n") endRecord()
    else if (char !== "\r") field += char
  }

  endRecord()

  const [header = [], ...rest] = parsed

  return rest.map((cells) => new Map(header.map((name, at) => [name, cells[at] ?? ""])))
}
