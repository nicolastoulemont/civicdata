import type { Ending } from "@civicdata/domain"
import { useIsMutating, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { DateTime, Match } from "effect"
import { useEffect } from "react"

import { Badge } from "@/components/ui/badge"
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { answerKey, turnsQuery } from "@/conversation/useConversation"

import { ago } from "./ago.ts"
import { type Entry, forget } from "./store.ts"

// How a conversation's last question stands, in a word and a colour.
interface Status {
  readonly label: string
  readonly className: string
}

const working: Status = {
  label: "Working",
  className: "bg-status-working/10 text-status-working",
}

// How an answer ended. The match is exhaustive, so a new ending fails the
// typecheck until it gets a status.
const ended = (answer: Ending): Status =>
  Match.valueTags(answer, {
    Answered: () => ({
      label: "Answered",
      className: "bg-status-answered/10 text-status-answered",
    }),
    Asked: () => ({ label: "Your reply", className: "bg-status-reply/10 text-status-reply" }),
    Unanswered: () => ({ label: "No data", className: "bg-status-idle/10 text-status-idle" }),
    Stopped: () => ({ label: "Stopped", className: "bg-status-idle/10 text-status-idle" }),
  })

interface RowProps {
  entry: Entry
  current: boolean
  now: DateTime.Utc
}

// One conversation, as a card: its title on up to two lines, the whole of it
// in a tooltip, then its status and how long ago it was last asked. The server
// keeps answering after the page leaves, so a conversation it reports
// answering is checked again until it is done.
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
  const last = data?.answered.at(-1)
  // No status while the turns load.
  const status = answering ? working : last === undefined ? undefined : ended(last.answer)

  useEffect(() => {
    if (gone) forget(id)
  }, [gone, id])

  return (
    <SidebarMenuItem>
      <Tooltip>
        <SidebarMenuButton
          isActive={current}
          className="h-auto flex-col items-stretch gap-1.5 py-2"
          render={
            <TooltipTrigger
              render={<Link to="/c/$id" params={{ id }} onClick={() => setOpenMobile(false)} />}
            />
          }
        >
          <div className="line-clamp-2 break-words">{title}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            {status === undefined ? null : (
              <Badge className={status.className}>
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full bg-current",
                    status === working && "motion-safe:animate-pulse",
                  )}
                />
                {status.label}
              </Badge>
            )}
            <time className="ml-auto" dateTime={DateTime.formatIso(askedAt)}>
              {ago(askedAt, now)}
            </time>
          </div>
        </SidebarMenuButton>
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  )
}
