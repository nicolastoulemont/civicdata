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

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Explore } from "@/explore/Explore"

import { useShow } from "./useConversation.ts"

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
}

// One chart that answered a question, in the explorer card so it can be
// changed where it is. The conversation keeps the change, and the next
// question builds on it. A change shows at once; one the server refuses
// returns to the chart kept before, with why.
export const Answer = ({ id, turn, chart, agent, shown }: AnswerProps) => {
  const showing = useShow(id, { turn, chart })
  const view = showing.isPending ? showing.variables : (shown ?? agent.view)
  // Open as the agent drew the chart. A person's changes are not kept with
  // the conversation: a copied link carries them instead.
  const [overlays, setOverlays] = useState<ReadonlyArray<Overlay>>(agent.overlays ?? [])

  return (
    <>
      <Explore
        view={view}
        onChange={(next) => showing.mutate(next)}
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
    </>
  )
}
