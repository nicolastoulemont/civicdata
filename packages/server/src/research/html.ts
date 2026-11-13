import { decodeHTML } from "entities"

// A page's `<meta name content>` tags, as lower-case names and decoded
// contents. A tag inside a comment or a script is not metadata.
export const metaOf = (html: string) =>
  [
    ...html.matchAll(/<!--[\s\S]*?--!?>|<script\b[\s\S]*?<\/script[^>]*>|<meta\b([^>]*)>/gi),
  ].flatMap(([, attributes]) => {
    if (attributes === undefined) return []

    const values = new Map(
      [...attributes.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)].map(
        ([, key = "", double, single, bare]) => [
          key.toLowerCase(),
          decodeHTML(double ?? single ?? bare ?? ""),
        ],
      ),
    )

    const name = values.get("name")
    const content = values.get("content")

    return name === undefined || content === undefined
      ? []
      : [{ name: name.toLowerCase(), content }]
  })
