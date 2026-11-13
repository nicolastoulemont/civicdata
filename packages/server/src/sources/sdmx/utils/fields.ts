// One line, with RFC 4180 quoting. Codes and numbers are never quoted;
// attributes and labels may be.
export const fields = (line: string) => {
  if (!line.includes('"')) return line.split(",")

  const values: Array<string> = []
  let value = ""
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (quoted && char === '"' && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) {
      values.push(value)
      value = ""
    } else value += char
  }

  values.push(value)

  return values
}
