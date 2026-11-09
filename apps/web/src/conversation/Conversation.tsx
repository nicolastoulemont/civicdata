import type { ConversationId } from "@civicdata/domain"
import { useEffect, useRef, useState } from "react"

import { FollowUp } from "./FollowUp.tsx"
import { Header } from "./Header.tsx"
import { Lane } from "./Lane.tsx"
import { Problem } from "./Problem.tsx"
import { Scroll } from "./Scroll.tsx"
import { Timeline } from "./Timeline.tsx"
import { useConversation } from "./useConversation.ts"

interface ConversationProps {
  id: ConversationId
  first: string | undefined
}

// A conversation with the agent, newest question last. `first` is a question
// to ask as soon as the conversation opens: the one typed on the home page.
export const Conversation = ({ id, first }: ConversationProps) => {
  const { turns, pending, failures, retry, answering, stop, stopping, ask } = useConversation(id)
  const [dismissed, setDismissed] = useState<Error | null>(null)
  const sent = useRef(false)

  useEffect(() => {
    if (first === undefined || sent.current) return

    sent.current = true
    ask(first)
  }, [first, ask])

  const all = turns.data ?? []

  const empty =
    all.length === 0 && pending === undefined && failures.length === 0 && first === undefined

  return (
    <div className="flex h-svh flex-col">
      <Header title={all[0]?.question ?? pending?.question ?? first} />
      <main className="flex min-h-0 flex-1 flex-col gap-3">
        <Scroll key={id} anchor={pending?.steps.length === 0 ? pending.question : undefined}>
          <Lane>
            <div className="flex flex-col gap-6">
              {turns.isError && turns.error !== dismissed ? (
                <Problem error={turns.error} dismiss={() => setDismissed(turns.error)} />
              ) : null}
              {empty ? (
                <p className="text-muted-foreground">
                  No questions yet. A conversation is deleted 30 days after its last question.
                </p>
              ) : null}
              <Timeline
                id={id}
                turns={all}
                pending={pending}
                failures={failures}
                retry={retry}
                answering={answering}
              />
            </div>
          </Lane>
        </Scroll>
        <FollowUp
          pending={pending !== undefined}
          last={all.at(-1)?.answer}
          answering={answering ? { stop, stopping } : undefined}
          ask={ask}
        />
      </main>
    </div>
  )
}
