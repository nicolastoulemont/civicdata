import type { View } from "@civicdata/domain"
import { Check, Link } from "lucide-react"

import { useCopy } from "@/clipboard"
import { Button } from "@/components/ui/button"

import { toQuery } from "./search.ts"

const labels = { copied: "Link copied", failed: "Could not copy" } as const

interface CopyLinkProps {
  view: View
}

// Copies the explorer's address for the View. The outcome shows until the
// View changes.
export const CopyLink = ({ view }: CopyLinkProps) => {
  const query = toQuery(view)
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
