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
} from "@openfacts/domain"
import type { TFunction } from "i18next"
import { lazy, Suspense, useState } from "react"
import { useTranslation } from "react-i18next"

import { Act } from "@/act"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

import { useAct, useShow } from "./useConversation.ts"

// The chart's code loads apart from the conversation's, so the page shows
// before it; the conversation's preload starts fetching it.
const Explore = lazy(() =>
  import("@/explore/Explore").then((module) => ({ default: module.Explore })),
)

// Why a changed chart could not be kept, in plain words.
const problemOf = (error: Error, t: TFunction<"conversation">) =>
  error instanceof TurnNotFound
    ? t(($) => $["This conversation no longer has this answer."])
    : error instanceof NoChart
      ? t(($) => $["This answer has no chart to change."])
      : error instanceof AgentUnavailable
        ? t(($) => $["Conversations cannot be reached. Try again in a moment."])
        : t(($) => $["Try again in a moment."])

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
  const { t } = useTranslation("conversation")

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
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <Explore
          view={view}
          onChange={(next) => (kept ? showing.mutate(next) : setDrawn(next))}
          overlays={overlays}
          onOverlays={setOverlays}
          heading="h3"
          agent={agent.view}
        />
      </Suspense>
      {showing.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t(($) => $["Your change could not be kept"])}</AlertTitle>
          <AlertDescription>{problemOf(showing.error, t)}</AlertDescription>
        </Alert>
      ) : null}
    </Act>
  )
}
