import { ConversationId } from "@civicdata/domain"
import { createFileRoute, notFound, useLocation } from "@tanstack/react-router"
import { Option, Schema, Struct } from "effect"
import { useEffect } from "react"

import { Conversation } from "@/conversation/Conversation"
import { preload } from "@/conversation/preload"

const decodeId = Schema.decodeUnknownOption(ConversationId)

const ConversationPage = () => {
  const { id } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  // The question typed on the home page, carried in history state.
  const first = useLocation({ select: (location) => location.state.question })

  // The browser keeps history state across back, forward and reload, so the
  // entry forgets the question once Conversation has asked it: its effect runs
  // before this one. A return then shows the saved turns and asks nothing.
  useEffect(() => {
    if (first === undefined) return

    void navigate({
      to: ".",
      search: true,
      hash: true,
      state: Struct.omit(["question"]),
      replace: true,
      resetScroll: false,
    })
  }, [first, navigate])

  return <Conversation id={id} first={first} />
}

export const Route = createFileRoute("/_chat/c/$id")({
  // An id that is not a conversation id is a missing page.
  beforeLoad: ({ params }) =>
    Option.match(decodeId(params.id), {
      onNone: () => {
        throw notFound()
      },
      onSome: (id) => ({ id }),
    }),
  // Runs on hover or focus of a link here, and on arrival.
  loader: ({ context: { queryClient, id } }) => preload({ queryClient, id }),
  head: () => ({ meta: [{ title: "Conversation · civicdata" }] }),
  component: ConversationPage,
})
