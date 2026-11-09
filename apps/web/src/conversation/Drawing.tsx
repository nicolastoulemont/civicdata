import type { Drawn } from "@civicdata/domain"
import { useState } from "react"

import { Explore } from "@/explore/Explore"
import type { Overlay } from "@/explore/politics"

interface DrawingProps {
  step: typeof Drawn.Type
}

// A chart of the answer in progress, shown as soon as the agent draws it,
// with its takeaway once written. The turn is kept only when the answer
// ends, so a change made before then shows here and is not kept.
export const Drawing = ({ step }: DrawingProps) => {
  const [view, setView] = useState(step.view)
  const [overlays, setOverlays] = useState<ReadonlyArray<Overlay>>([])

  return (
    <Explore
      view={view}
      onChange={setView}
      overlays={overlays}
      onOverlays={setOverlays}
      heading="h3"
      agent={step}
    />
  )
}
