import type { Overlay, View } from "@openfacts/domain"
import { Check, Link } from "lucide-react"
import { use } from "react"
import { useTranslation } from "react-i18next"

import { Act } from "@/act"
import { useCopy } from "@/clipboard"
import { Button } from "@/components/ui/button"

import { toQuery } from "./search.ts"

interface CopyLinkProps {
  view: View
  overlays: ReadonlyArray<Overlay>
}

// Copies the explorer's address for the View with what is drawn over it, so
// the link opens the chart as it is shown. The outcome shows until either
// changes.
export const CopyLink = ({ view, overlays }: CopyLinkProps) => {
  const { t } = useTranslation("explore")

  const labels = {
    copied: t(($) => $["Link copied"]),
    failed: t(($) => $["Could not copy"]),
  } as const

  const query = toQuery(view, overlays)
  const { outcome, copy } = useCopy(query)
  const act = use(Act)

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        copy(new URL(`/explore${query}`, window.location.origin).href)
        act("share")
      }}
    >
      {outcome === "copied" ? <Check aria-hidden /> : <Link aria-hidden />}
      {outcome === undefined ? t(($) => $["Copy link"]) : labels[outcome]}
    </Button>
  )
}
