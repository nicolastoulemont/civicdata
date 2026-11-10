import type { Chart, Overlay } from "@civicdata/domain"
import { useState } from "react"

import { Explore } from "@/explore/Explore"

interface DrawingProps {
  chart: Chart
}

// A chart of the answer in progress, shown as soon as the agent draws it.
// The turn is kept only when the answer ends, so a change made before then
// shows here and is not kept.
export const Drawing = ({ chart }: DrawingProps) => {
  const [view, setView] = useState(chart.view)
  const [overlays, setOverlays] = useState<ReadonlyArray<Overlay>>(chart.overlays ?? [])

  return (
    <Explore
      view={view}
      onChange={setView}
      overlays={overlays}
      onOverlays={setOverlays}
      heading="h3"
      agent={chart.view}
    />
  )
}
