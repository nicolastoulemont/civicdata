import { cn } from "cn"

import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"

interface ToggleProps {
  className?: string
}

// The page's sidebar toggle. On desktop the open sidebar carries its own, so
// this one shows only while the sidebar is closed. Phones always show it: the
// sidebar there is a drawer over the page.
export const Toggle = ({ className }: ToggleProps) => {
  const { open } = useSidebar()

  return <SidebarTrigger className={cn(open && "md:hidden", className)} />
}
