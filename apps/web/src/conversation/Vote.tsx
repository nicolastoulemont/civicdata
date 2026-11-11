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
import { ThumbsDown, ThumbsUp } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { useVote } from "./useConversation.ts"

const isReason = Schema.is(Reason)

const isDown = Schema.is(Down)

// What went wrong, in the words the person picks from.
const reasons: ReadonlyArray<{ reason: Reason; label: string }> = [
  { reason: "indicator", label: "Wrong measure" },
  { reason: "countries", label: "Wrong countries" },
  { reason: "years", label: "Wrong years" },
  { reason: "data", label: "Missing data" },
  { reason: "text", label: "Wrong text" },
  { reason: "other", label: "Something else" },
]

// Why a vote could not be kept, in plain words.
const problemOf = (error: Error) =>
  error instanceof TurnNotFound
    ? "This conversation no longer has this answer."
    : error instanceof AgentUnavailable
      ? "Conversations cannot be reached. Try again in a moment."
      : "Try again in a moment."

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
  const voting = useVote(id, turn)
  const current = voting.isPending ? voting.variables : vote

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        aria-label="Was this answer useful?"
        size="sm"
        value={current === undefined ? [] : [isDown(current) ? "Down" : "Up"]}
        onValueChange={([pressed]) => {
          if (pressed === "Up") voting.mutate(Up.make({}))

          if (pressed === "Down") voting.mutate(Down.make({}))
        }}
      >
        <ToggleGroupItem value="Up" aria-label="Useful">
          <ThumbsUp />
        </ToggleGroupItem>
        <ToggleGroupItem value="Down" aria-label="Not useful">
          <ThumbsDown />
        </ToggleGroupItem>
      </ToggleGroup>
      {current !== undefined && isDown(current) ? (
        <ToggleGroup
          aria-label="What went wrong?"
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
          Your vote could not be kept. {problemOf(voting.error)}
        </p>
      ) : null}
    </div>
  )
}
