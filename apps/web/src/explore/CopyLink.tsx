import type { View } from "@civicdata/domain"
import { Check, Link } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

const labels = { copied: "Link copied", failed: "Could not copy" } as const

// Copies the page's address, which holds the View. The outcome shows until
// the View changes.
export const CopyLink = ({ view }: { view: View }) => {
  const [copy, setCopy] = useState<{ view: View; outcome: keyof typeof labels }>()
  const outcome = copy?.view === view ? copy.outcome : undefined

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void navigator.clipboard.writeText(window.location.href).then(
          () => setCopy({ view, outcome: "copied" }),
          () => setCopy({ view, outcome: "failed" }),
        )
      }
    >
      {outcome === "copied" ? <Check aria-hidden /> : <Link aria-hidden />}
      {outcome === undefined ? "Copy link" : labels[outcome]}
    </Button>
  )
}
