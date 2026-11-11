import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { usePanelRef } from "react-resizable-panels"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useIsMobile } from "@/hooks/use-mobile"

import { History } from "./History.tsx"

interface LayoutProps {
  children: ReactNode
}

// A page beside the list of past conversations. On desktop the two sit in
// resizable panels: the toggle collapses or expands the sidebar's panel, and
// dragging the panel shut closes the sidebar. A closed sidebar leaves the
// page, so its links are out of the tab order. On phones the sidebar is a
// drawer over the page.
export const Layout = ({ children }: LayoutProps) => {
  const { t } = useTranslation("common")
  const mobile = useIsMobile()
  const sidebar = usePanelRef()
  const [open, setOpen] = useState(true)

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
        setOpen(next)

        if (next) sidebar.current?.expand()
        else sidebar.current?.collapse()
      }}
    >
      <ResizablePanelGroup orientation="horizontal" className="h-svh">
        <ResizablePanel
          panelRef={sidebar}
          collapsible
          defaultSize={256}
          minSize={208}
          maxSize={448}
          onResize={(size) => setOpen(size.inPixels > 0)}
        >
          {open ? <History /> : null}
        </ResizablePanel>
        <ResizableHandle aria-label={t(($) => $.resizeSidebar)} />
        <ResizablePanel>
          <SidebarInset className="min-h-full">{children}</SidebarInset>
        </ResizablePanel>
      </ResizablePanelGroup>
    </SidebarProvider>
  )
}
