import { Effect, Result, Schema } from "effect"

// A CSV file whose cells cannot be read, at its first unreadable line.
class Malformed extends Schema.TaggedError<Malformed, { readonly brand: unique symbol }>()(
  "Malformed",
  { line: Schema.Int },
) {}

// One RFC 4180 field and what ends it: a comma, a line break, or the end of
// the file. A quoted field may hold commas, line breaks and doubled quotes.
const field = /(?:"((?:[^"]|"")*)"|([^,\r\n"]*))(,|\r\n|\n|\r|$)/y

// Each line of a CSV file as its cells, or Malformed at the line a stray
// quote breaks.
const lines = (text: string): Result.Result<Array<Array<string>>, Malformed> => {
  const found: Array<Array<string>> = []
  let line: Array<string> = []

  field.lastIndex = 0

  while (field.lastIndex < text.length) {
    const match = field.exec(text)

    if (match === null) return Result.fail(new Malformed({ line: found.length + 1 }))

    const [, quoted, plain = "", end] = match

    line.push(quoted === undefined ? plain : quoted.replaceAll('""', '"'))

    if (end !== ",") {
      found.push(line)
      line = []
    }
  }

  return Result.succeed(found)
}

// A CSV file's rows, each a record of its header's columns. A byte order
// mark is dropped. A row with more or fewer cells than the header fails the
// file: its columns cannot be trusted.
export const table = (text: string) =>
  Effect.fromResult(lines(text.replace(/^﻿/, ""))).pipe(
    Effect.flatMap(([header = [], ...rest]) =>
      Effect.forEach(rest, (cells, index) =>
        cells.length === header.length
          ? Effect.succeed(
              Object.fromEntries(header.map((column, at) => [column, cells[at] ?? ""])),
            )
          : Effect.fail(new Malformed({ line: index + 2 })),
      ),
    ),
  )
