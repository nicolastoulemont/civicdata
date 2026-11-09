import type { ReactNode } from "react"

// The centered column the timeline and the composer share: 46rem of content,
// with 12px gutters on phones and 48px from `sm` up, outside that width.
export const Lane = ({ children }: { children: ReactNode }) => (
  <div className="w-full px-3 sm:px-12">
    <div className="mx-auto w-full max-w-184 min-w-0">{children}</div>
  </div>
)
