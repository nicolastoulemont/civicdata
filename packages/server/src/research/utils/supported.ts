import type { Copy } from "../archive.schemas.ts"
import { handleOf } from "./handleOf.ts"

interface Item extends Copy {
  readonly landing_page_url: string
}

export const supported = (copy: Copy): copy is Item => {
  if (
    !copy.id.startsWith("pmh:oai:econstor.eu:10419/") ||
    copy.landing_page_url === null ||
    !URL.canParse(copy.landing_page_url)
  )
    return false
  const url = new URL(copy.landing_page_url)

  return (
    url.protocol === "https:" &&
    (url.hostname === "www.econstor.eu" || url.hostname === "hdl.handle.net") &&
    handleOf(url.href) === handleOf(copy.id)
  )
}
