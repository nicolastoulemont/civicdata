import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { usePanelRef } from "react-resizable-panels"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useIsMobile } from "@/hooks/use-mobile"

import { History } from "./History.tsx"
import { save } from "./size.ts"

interface LayoutProps {
  children: ReactNode
  // The sidebar's saved share of the window, in percent, or undefined to
  // start at its default width.
  size: number | undefined
}

// A page beside the list of past conversations. On desktop the two sit in
// resizable panels: the toggle collapses or expands the sidebar's panel, and
// dragging the panel shut closes the sidebar. A closed sidebar leaves the
// page, so its links are out of the tab order. Every change to the panels is
// saved, so a reload opens them as they were. On phones the sidebar is a
// drawer over the page.
export const Layout = ({ children, size }: LayoutProps) => {
  const { t } = useTranslation("common")
  const mobile = useIsMobile()
  const sidebar = usePanelRef()
  const [open, setOpen] = useState(size !== 0)

  if (mobile) {
    return (
      <SidebarProvider>
        <History />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    )
  }

  return (
    <SidebarProvider
      open={open}
      onOpenChange={(next) => {
        const panel = sidebar.current

        setOpen(next)

        if (panel === null) return

        if (next) panel.expand()
        else panel.collapse()

        save(panel.getSize().asPercentage)
      }}
    >
      {/* Only the reader's own changes are saved: the library also reports
          the layout it computes on mount and as the window resizes. */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="h-svh"
        defaultLayout={size === undefined ? undefined : { sidebar: size, page: 100 - size }}
        onLayoutChanged={(layout, { isUserInteraction, requestedLayout }) => {
          const next = (requestedLayout ?? layout)["sidebar"]

          if (isUserInteraction && next !== undefined) save(next)
        }}
      >
        {/* The server renders a 0 in defaultLayout at defaultSize, so a
            closed sidebar also starts at 0 rather than as an empty column. */}
        <ResizablePanel
          id="sidebar"
          panelRef={sidebar}
          collapsible
          defaultSize={size === 0 ? 0 : 256}
          minSize={208}
          maxSize={448}
          onResize={(next) => setOpen(next.inPixels > 0)}
        >
          {open ? <History /> : null}
        </ResizablePanel>
        <ResizableHandle aria-label={t(($) => $.resizeSidebar)} />
        <ResizablePanel id="page">
          <SidebarInset className="min-h-full">{children}</SidebarInset>
        </ResizablePanel>
      </ResizablePanelGroup>
    </SidebarProvider>
  )
}
