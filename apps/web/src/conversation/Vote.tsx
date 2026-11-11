import {
  AgentUnavailable,
  type ConversationId,
  Down,
  Reason,
  type TurnIndex,
  TurnNotFound,
  Up,
  type Vote as Choice,
} from "@civicdata/domain"
import { Schema } from "effect"
import type { TFunction } from "i18next"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { useVote } from "./useConversation.ts"

const isReason = Schema.is(Reason)

const isDown = Schema.is(Down)

// What went wrong, in the words the person picks from.

// Why a vote could not be kept, in plain words.
const problemOf = (error: Error, t: TFunction<"conversation">) =>
  error instanceof TurnNotFound
    ? t(($) => $["This conversation no longer has this answer."])
    : error instanceof AgentUnavailable
      ? t(($) => $["Conversations cannot be reached. Try again in a moment."])
      : t(($) => $["Try again in a moment."])

interface VoteProps {
  id: ConversationId
  turn: TurnIndex
  // The vote the conversation kept, if any.
  vote: Choice | undefined
}

// Asks whether an answer was useful and, when it was not, what went wrong.
// A vote shows at once; one the server refuses returns to the vote kept
// before, with why. Pressing the pressed thumb keeps the vote: the last one
// counts, and there is no taking it back.
export const Vote = ({ id, turn, vote }: VoteProps) => {
  const { t } = useTranslation("conversation")

  const reasons = [
    { reason: "indicator", label: t(($) => $["Wrong measure"]) },
    { reason: "countries", label: t(($) => $["Wrong countries"]) },
    { reason: "years", label: t(($) => $["Wrong years"]) },
    { reason: "data", label: t(($) => $["Missing data"]) },
    { reason: "text", label: t(($) => $["Wrong text"]) },
    { reason: "other", label: t(($) => $["Something else"]) },
  ] as const satisfies ReadonlyArray<{ reason: Reason; label: string }>

  const voting = useVote(id, turn)
  const current = voting.isPending ? voting.variables : vote

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        aria-label={t(($) => $["Was this answer useful?"])}
        size="sm"
        value={current === undefined ? [] : [isDown(current) ? "Down" : "Up"]}
        onValueChange={([pressed]) => {
          if (pressed === "Up") voting.mutate(Up.make({}))

          if (pressed === "Down") voting.mutate(Down.make({}))
        }}
      >
        <ToggleGroupItem value="Up" aria-label={t(($) => $["Useful"])}>
          <ThumbsUp />
        </ToggleGroupItem>
        <ToggleGroupItem value="Down" aria-label={t(($) => $["Not useful"])}>
          <ThumbsDown />
        </ToggleGroupItem>
      </ToggleGroup>
      {current !== undefined && isDown(current) ? (
        <ToggleGroup
          aria-label={t(($) => $["What went wrong?"])}
          size="sm"
          variant="outline"
          className="flex-wrap"
          value={current.reason === undefined ? [] : [current.reason]}
          onValueChange={([pressed]) =>
            voting.mutate(isReason(pressed) ? Down.make({ reason: pressed }) : Down.make({}))
          }
        >
          {reasons.map(({ reason, label }) => (
            <ToggleGroupItem key={reason} value={reason}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}
      {voting.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(($) => $["Your vote could not be kept. {{value}}"], {
            value: problemOf(voting.error, t),
          })}
        </p>
      ) : null}
    </div>
  )
}
