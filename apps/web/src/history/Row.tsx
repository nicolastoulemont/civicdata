import { ConversationNotFound, type Ending, type Turns } from "@openfacts/domain"
import { useIsMutating, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { cn } from "cn"
import { Data, DateTime, Match } from "effect"
import type { TFunction } from "i18next"
import { Pencil, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  SidebarInput,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { answerKey, turnsQuery } from "@/conversation/useConversation"

import { ago } from "./ago.ts"
import { type Entry, forget, rename } from "./store.ts"

// How a conversation stands: its turns still loading, a question being
// answered, how its last answer ended, kept with no answer (its first
// question failed), or deleted by the server.
type Status = Data.TaggedEnum<{
  Loading: {}
  Working: {}
  Ended: { readonly answer: Ending }
  Unanswered: {}
  Gone: {}
}>

const Status = Data.taggedEnum<Status>()

const isWorking = Status.$is("Working")
const isGone = Status.$is("Gone")

interface StatusInput {
  // Whether this page is asking a question in the conversation.
  readonly asking: boolean
  readonly data: Turns | undefined
  readonly error: Error | null
}

// Only the server says a conversation is gone. An answer in progress
// outranks that: a question asked a moment ago can reach the server after
// the read that found no conversation.
const statusOf = ({ asking, data, error }: StatusInput): Status => {
  if (asking || data?.answering !== undefined) return Status.Working()

  if (error instanceof ConversationNotFound) return Status.Gone()

  if (data === undefined) return Status.Loading()

  const last = data.answered.at(-1)

  return last === undefined ? Status.Unanswered() : Status.Ended({ answer: last.answer })
}

// A status in a word and a colour.
interface Badged {
  readonly label: string
  readonly className: string
}

const idle = "bg-status-idle/10 text-status-idle"

// How an answer ended. The match is exhaustive, so a new ending fails the
// typecheck until it gets a badge.
const ended = (answer: Ending, t: TFunction<"home">): Badged =>
  Match.valueTags(answer, {
    Answered: () => ({
      label: t(($) => $.answered),
      className: "bg-status-answered/10 text-status-answered",
    }),
    Asked: () => ({ label: t(($) => $.reply), className: "bg-status-reply/10 text-status-reply" }),
    Unanswered: () => ({ label: t(($) => $.noData), className: idle }),
    Exhausted: () => ({ label: t(($) => $.cutShort), className: idle }),
    Stopped: () => ({ label: t(($) => $.stopped), className: idle }),
  })

// No badge while the turns load, or once the conversation is gone.
const badged = (status: Status, t: TFunction<"home">): Badged | undefined =>
  Match.valueTags(status, {
    Loading: () => undefined,
    Working: () => ({
      label: t(($) => $.working),
      className: "bg-status-working/10 text-status-working",
    }),
    Ended: ({ answer }) => ended(answer, t),
    Unanswered: () => ({ label: t(($) => $.notAnswered), className: idle }),
    Gone: () => undefined,
  })

interface RowProps {
  entry: Entry
  current: boolean
  now: DateTime.Utc
}

// One conversation, as a card: its title on up to two lines, the whole of it
// in a tooltip, then its status and how long ago it was last asked. The server
// keeps answering after the page leaves, so a conversation it reports
// answering is checked again until it is done. Right-clicking the card, or a
// long press, opens a menu to rename it or delete it from this browser. While
// renaming, the title is an input: Enter or leaving it keeps the new title,
// Escape keeps the old one.
export const Row = ({ entry: { id, title, askedAt }, current, now }: RowProps) => {
  const { t } = useTranslation("home")
  const { setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const asking = useIsMutating({ mutationKey: answerKey(id) }) > 0
  const [renaming, setRenaming] = useState(false)
  const link = useRef<HTMLAnchorElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const { data, error } = useQuery({
    ...turnsQuery(id),
    refetchInterval: (query) =>
      !asking && query.state.data?.answering !== undefined ? 5000 : false,
  })

  const status = statusOf({ asking, data, error })
  const badge = badged(status, t)
  // The server deletes a conversation 30 days after its last question.
  const gone = isGone(status)

  useEffect(() => {
    if (gone) forget(id)
  }, [gone, id])

  // Ends renaming from the keyboard, back on the card's link.
  const done = () => {
    flushSync(() => setRenaming(false))
    link.current?.focus()
  }

  const remove = () => {
    forget(id)

    if (current) void navigate({ to: "/" })
  }

  const meta = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
      {badge === undefined ? null : (
        <Badge className={badge.className}>
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full bg-current",
              isWorking(status) && "motion-safe:animate-pulse",
            )}
          />
          {badge.label}
        </Badge>
      )}
      <time className="ml-auto" dateTime={DateTime.formatIso(askedAt)}>
        {ago(askedAt, { now, t })}
      </time>
    </div>
  )

  return (
    <ContextMenu disabled={renaming}>
      <ContextMenuTrigger render={<SidebarMenuItem />}>
        {renaming ? (
          <form
            className="flex flex-col gap-1.5 rounded-md bg-sidebar-accent p-2"
            onSubmit={(event) => {
              event.preventDefault()
              rename(id, field.current?.value ?? title)
              done()
            }}
          >
            <SidebarInput
              ref={field}
              aria-label={t(($) => $.title)}
              defaultValue={title}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => {
                rename(id, event.currentTarget.value)
                setRenaming(false)
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return

                // Leaving the input keeps what it holds, so it holds the old
                // title again first.
                event.currentTarget.value = title
                done()
              }}
            />
            {meta}
          </form>
        ) : (
          <Tooltip>
            <SidebarMenuButton
              isActive={current}
              className="h-auto flex-col items-stretch gap-1.5 py-2"
              render={
                <TooltipTrigger
                  render={
                    <Link
                      ref={link}
                      to="/c/$id"
                      params={{ id }}
                      onClick={() => setOpenMobile(false)}
                    />
                  }
                />
              }
            >
              <div className="line-clamp-2 break-words">{title}</div>
              {meta}
            </SidebarMenuButton>
            <TooltipContent side="right">{title}</TooltipContent>
          </Tooltip>
        )}
      </ContextMenuTrigger>
      {/* Renaming moves focus to the title's input once the menu closes. */}
      <ContextMenuContent finalFocus={() => field.current ?? true}>
        <ContextMenuItem onClick={() => setRenaming(true)}>
          <Pencil aria-hidden />
          {t(($) => $.rename)}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={remove}>
          <Trash2 aria-hidden />
          {t(($) => $.delete)}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
