import { Option, Schema, SchemaTransformation } from "effect"

// The sidebar's share of the window on desktop, in percent, as the reader
// last left it; 0 is closed. A cookie keeps it, so the server renders the
// page as it was before a reload instead of the page jumping once it
// hydrates. Its name and format outlive deploys: changing either resets every
// visitor's sidebar.
const name = "sidebar"

// A year, renewed at every change.
const maxAge = 365 * 24 * 60 * 60

// A plain decimal, so an empty or blank value is no size rather than 0.
const Size = Schema.String.check(Schema.isPattern(/^\d+(\.\d+)?$/)).pipe(
  Schema.decodeTo(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
    SchemaTransformation.numberFromString,
  ),
)

const decode = Schema.decodeUnknownOption(Size)

// The size kept in a Cookie header or in document.cookie, which share a
// format, or undefined when there is none or it cannot be read.
export const saved = (cookies: string | undefined) => {
  const pair = cookies
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))

  return Option.getOrUndefined(decode(pair?.slice(name.length + 1)))
}

// Rounded to a hundredth of a percent, which keeps it a plain decimal.
// Browsers that refuse cookies keep nothing, and the next load starts from
// the default width.
export const save = (size: number) => {
  document.cookie = `${name}=${Math.round(size * 100) / 100}; path=/; max-age=${maxAge}; samesite=lax`
}
