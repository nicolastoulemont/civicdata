import {
  AgentUnavailable,
  type Chart,
  type ChartIndex,
  type ConversationId,
  NoChart,
  type Overlay,
  type TurnIndex,
  TurnNotFound,
  type View,
} from "@civicdata/domain"
import { useState } from "react"

import { Act } from "@/act"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Explore } from "@/explore/Explore"

import { useAct, useShow } from "./useConversation.ts"

// Why a changed chart could not be kept, in plain words.
const problemOf = (error: Error) =>
  error instanceof TurnNotFound
    ? "This conversation no longer has this answer."
    : error instanceof NoChart
      ? "This answer has no chart to change."
      : error instanceof AgentUnavailable
        ? "Conversations cannot be reached. Try again in a moment."
        : "Try again in a moment."

interface AnswerProps {
  id: ConversationId
  turn: TurnIndex
  // The chart's place in its answer.
  chart: ChartIndex
  agent: Chart
  // The chart a person changed the agent's to, once saved.
  shown: View | undefined
  // Whether the conversation keeps the answer yet. It keeps it only when the
  // answer ends.
  kept: boolean
}

// One chart that answered a question, in the explorer card so it can be
// changed where it is. Once the answer is kept, the conversation keeps the
// change, and the next question builds on it: a change shows at once, and one
// the server refuses returns to the chart kept before, with why. A change made
// while the answer runs shows here and is not kept. The chart stays the same
// card from the moment the agent draws it, so it does not redraw when the
// answer is kept. Once kept, a download of its data or a copy of its link is
// counted on the answer.
export const Answer = ({ id, turn, chart, agent, shown, kept }: AnswerProps) => {
  const showing = useShow(id, { turn, chart })
  const acting = useAct(id, turn)
  const [drawn, setDrawn] = useState(agent.view)
  const saved = showing.isPending ? showing.variables : (shown ?? agent.view)
  const view = kept ? saved : drawn
  // Open as the agent drew the chart. A person's changes are not kept with
  // the conversation: a copied link carries them instead.
  const [overlays, setOverlays] = useState<ReadonlyArray<Overlay>>(agent.overlays ?? [])

  return (
    <Act value={(action) => (kept ? acting.mutate(action) : undefined)}>
      <Explore
        view={view}
        onChange={(next) => (kept ? showing.mutate(next) : setDrawn(next))}
        overlays={overlays}
        onOverlays={setOverlays}
        heading="h3"
        agent={agent.view}
      />
      {showing.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Your change could not be kept</AlertTitle>
          <AlertDescription>{problemOf(showing.error)}</AlertDescription>
        </Alert>
      ) : null}
    </Act>
  )
}
