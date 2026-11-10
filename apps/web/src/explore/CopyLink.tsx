import type { Overlay, View } from "@civicdata/domain"
import { Check, Link } from "lucide-react"

import { useCopy } from "@/clipboard"
import { Button } from "@/components/ui/button"

import { toQuery } from "./search.ts"

const labels = { copied: "Link copied", failed: "Could not copy" } as const

interface CopyLinkProps {
  view: View
  overlays: ReadonlyArray<Overlay>
}

// Copies the explorer's address for the View with what is drawn over it, so
// the link opens the chart as it is shown. The outcome shows until either
// changes.
export const CopyLink = ({ view, overlays }: CopyLinkProps) => {
  const query = toQuery(view, overlays)
  const { outcome, copy } = useCopy(query)

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => copy(new URL(`/explore${query}`, window.location.origin).href)}
    >
      {outcome === "copied" ? <Check aria-hidden /> : <Link aria-hidden />}
      {outcome === undefined ? "Copy link" : labels[outcome]}
    </Button>
  )
}
