import { useIsMutating, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { DateTime } from "effect"
import { useEffect } from "react"

import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { answerKey, turnsQuery } from "@/conversation/useConversation"

import { ago } from "./ago.ts"
import { type Entry, forget } from "./store.ts"

interface RowProps {
  entry: Entry
  current: boolean
  now: DateTime.Utc
}

// One conversation: its title, how long ago it was last asked, and a dot while
// an answer is in progress. The server keeps answering after the page leaves,
// so a conversation it reports answering is checked again until it is done.
export const Row = ({ entry: { id, title, askedAt }, current, now }: RowProps) => {
  const { setOpenMobile } = useSidebar()
  const asking = useIsMutating({ mutationKey: answerKey(id) }) > 0

  const { data } = useQuery({
    ...turnsQuery(id),
    refetchInterval: (query) =>
      !asking && query.state.data?.answering !== undefined ? 5000 : false,
  })

  const answering = asking || data?.answering !== undefined
  // The server deletes a conversation 30 days after its last question, and
  // reads it as empty from then on.
  const gone = !answering && data?.answered.length === 0

  useEffect(() => {
    if (gone) forget(id)
  }, [gone, id])

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={current}
        render={<Link to="/c/$id" params={{ id }} onClick={() => setOpenMobile(false)} />}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {answering ? (
            <>
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-primary" />
              <span className="sr-only">Answering</span>
            </>
          ) : null}
          <time dateTime={DateTime.formatIso(askedAt)}>{ago(askedAt, now)}</time>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
