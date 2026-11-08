import { ConversationId } from "@civicdata/domain"
import { createFileRoute, notFound, useLocation } from "@tanstack/react-router"
import { Option, Schema } from "effect"

import { Conversation } from "@/conversation/Conversation"

const decodeId = Schema.decodeUnknownOption(ConversationId)

const ConversationPage = () => {
  const { id } = Route.useRouteContext()
  // The question typed on the home page, carried in history state so a reload
  // does not ask it twice.
  const first = useLocation({ select: (location) => location.state.question })

  return <Conversation id={id} first={first} />
}

export const Route = createFileRoute("/c/$id")({
  // An id that is not a conversation id is a missing page.
  beforeLoad: ({ params }) =>
    Option.match(decodeId(params.id), {
      onNone: () => {
        throw notFound()
      },
      onSome: (id) => ({ id }),
    }),
  head: () => ({ meta: [{ title: "Conversation · civicdata" }] }),
  component: ConversationPage,
})
