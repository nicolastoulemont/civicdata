import type { ConversationId } from "@civicdata/domain"
import { useEffect, useRef } from "react"

import { FollowUp } from "./FollowUp.tsx"
import { Header } from "./Header.tsx"
import { Lane } from "./Lane.tsx"
import { Problem } from "./Problem.tsx"
import { Timeline } from "./Timeline.tsx"
import { useConversation } from "./useConversation.ts"

interface ConversationProps {
  id: ConversationId
  first: string | undefined
}

// A conversation with the agent, newest question last. `first` is a question
// to ask as soon as the conversation opens: the one typed on the home page.
export const Conversation = ({ id, first }: ConversationProps) => {
  const { turns, pending, answering, ask } = useConversation(id)
  const sent = useRef(false)

  useEffect(() => {
    if (first === undefined || sent.current) return

    sent.current = true
    ask(first)
  }, [first, ask])

  const all = turns.data ?? []
  const empty = all.length === 0 && pending === undefined && first === undefined

  return (
    <div className="flex min-h-svh flex-col">
      <Header title={all[0]?.question ?? pending?.question ?? first} />
      <main className="flex flex-1 flex-col gap-8 pt-4">
        <Lane>
          <div className="flex flex-col gap-6">
            {turns.isError ? <Problem error={turns.error} /> : null}
            {empty ? (
              <p className="text-muted-foreground">
                No questions yet. A conversation is deleted 30 days after its last question.
              </p>
            ) : null}
            <Timeline turns={all} pending={pending} answering={answering} ask={ask} />
          </div>
        </Lane>
        <FollowUp last={all.at(-1)?.answer} answering={answering} ask={ask} />
      </main>
    </div>
  )
}
