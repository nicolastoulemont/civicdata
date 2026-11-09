import type { ReactNode } from "react"

// Who wrote a row. Sighted readers tell by the layout; screen readers jump
// between rows by these headings.
export const Author = ({ children }: { children: string }) => (
  <h2 className="sr-only">{children}</h2>
)

// A row's buttons. They fade in while the row is hovered or holds focus, and
// stay visible on touch screens, which cannot hover.
export const Actions = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
    {children}
  </div>
)

// The agent's row: no bubble and no avatar, the full width of the lane.
export const Agent = ({ children }: { children: ReactNode }) => (
  <div className="group flex min-w-0 flex-col gap-3">
    <Author>civicdata</Author>
    {children}
  </div>
)
