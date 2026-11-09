import type { ReactNode } from "react"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import { History } from "./History.tsx"

interface LayoutProps {
  children: ReactNode
}

// A page beside the list of past conversations.
export const Layout = ({ children }: LayoutProps) => (
  <SidebarProvider>
    <History />
    <SidebarInset>{children}</SidebarInset>
  </SidebarProvider>
)
