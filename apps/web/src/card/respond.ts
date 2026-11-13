import {
  DimensionsMissing,
  IndicatorNotFound,
  SourceUnavailable,
  TransformNotApplicable,
  type View,
} from "@repo/domain"

import { resolve } from "@/explore/api"
import { inProcess } from "@/explore/inProcess"
import { fromUrl } from "@/explore/search"

import { card } from "./card.ts"

const status = (code: number) => new Response(null, { status: code })

// The link-preview card for the chart at /explore with the same query string.
// A link that describes no chart is missing (404), as on /explore.
export const respond = async (request: Request) => {
  let view: View

  try {
    view = fromUrl(new URL(request.url))
  } catch {
    return status(404)
  }

  try {
    const png = await card(await resolve(view, inProcess))

    return new Response(png, {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
    })
  } catch (error) {
    if (
      error instanceof IndicatorNotFound ||
      error instanceof TransformNotApplicable ||
      error instanceof DimensionsMissing
    )
      return status(404)

    if (error instanceof SourceUnavailable) return status(502)

    throw error
  }
}
