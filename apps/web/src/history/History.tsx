import { Link, useParams } from "@tanstack/react-router"
import { DateTime } from "effect"
import { SquarePen } from "lucide-react"
import { useEffect, useId, useState } from "react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

import { Row } from "./Row.tsx"
import { useEntries } from "./store.ts"

// The time rows count from, a minute at a time.
const useNow = () => {
  const [now, setNow] = useState(DateTime.nowUnsafe)

  useEffect(() => {
    const timer = setInterval(() => setNow(DateTime.nowUnsafe()), 60_000)

    return () => clearInterval(timer)
  }, [])

  return now
}

// The sidebar: a link to start a conversation, then the conversations asked
// in this browser, newest first. A drawer on phones.
export const History = () => {
  const entries = useEntries()
  const { id } = useParams({ strict: false })
  const { setOpenMobile } = useSidebar()
  const now = useNow()
  const label = useId()

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/" onClick={() => setOpenMobile(false)} />}>
              <SquarePen aria-hidden />
              <span>New conversation</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-labelledby={label}>
          <SidebarGroup>
            <SidebarGroupLabel id={label}>Conversations</SidebarGroupLabel>
            {entries.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">
                The conversations you start are listed here, in this browser only.
              </p>
            ) : (
              <SidebarMenu>
                {entries.map((entry) => (
                  <Row key={entry.id} entry={entry} current={entry.id === id} now={now} />
                ))}
              </SidebarMenu>
            )}
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
