import type { ConversationId } from "@civicdata/domain"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { FollowUp } from "./FollowUp.tsx"
import { Header } from "./Header.tsx"
import { Lane } from "./Lane.tsx"
import { Problem } from "./Problem.tsx"
import { preview } from "./rail.ts"
import { Scroll } from "./Scroll.tsx"
import { entries } from "./timeline.ts"
import { Timeline } from "./Timeline.tsx"
import { Stop, useConversation } from "./useConversation.ts"

interface ConversationProps {
  id: ConversationId
  first: string | undefined
}

// A conversation with the agent, newest question last. `first` is a question
// to ask as soon as the conversation opens: the one typed on the home page.
export const Conversation = ({ id, first }: ConversationProps) => {
  const { t } = useTranslation("conversation")

  const { turns, error, pending, failures, retry, stop, ask } = useConversation(id)

  const [dismissed, setDismissed] = useState<Error | null>(null)
  const sent = useRef(false)

  useEffect(() => {
    if (first === undefined || sent.current) return

    sent.current = true
    ask(first)
  }, [first, ask])

  const questions = entries({ turns, failures, pending })

  const empty =
    turns.length === 0 && pending === undefined && failures.length === 0 && first === undefined

  return (
    <div className="flex h-svh flex-col">
      <Header title={turns[0]?.question ?? pending?.question ?? first} />
      <main className="flex min-h-0 flex-1 flex-col">
        <Scroll
          key={id}
          asked={pending?.via === "ask" ? pending.started : undefined}
          previews={questions.map((entry) => preview(entry, t))}
          composer={
            <FollowUp
              id={id}
              last={turns.at(-1)?.answer}
              answering={
                pending === undefined
                  ? undefined
                  : { stop, stopping: Stop.$is("Sent")(pending.stop) }
              }
              ask={ask}
            />
          }
        >
          <Lane>
            <div className="flex flex-col gap-6">
              {error !== null && error !== dismissed ? (
                <Problem error={error} dismiss={() => setDismissed(error)} />
              ) : null}
              {empty ? (
                <p className="text-muted-foreground">
                  {t(
                    ($) =>
                      $[
                        "No questions yet. A conversation is deleted 30 days after its last question."
                      ],
                  )}
                </p>
              ) : null}
              <Timeline
                id={id}
                entries={questions}
                retry={retry}
                answering={pending !== undefined}
              />
            </div>
          </Lane>
        </Scroll>
      </main>
    </div>
  )
}
