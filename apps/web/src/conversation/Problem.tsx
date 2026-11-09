import {
  AgentUnavailable,
  CatalogUnavailable,
  ConversationBusy,
  SourceUnavailable,
  TooManyQuestions,
} from "@civicdata/domain"
import { X } from "lucide-react"
import { useEffect, useState } from "react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { named } from "@/explore/format"

import type { Failure } from "./useConversation.ts"

const explain = (error: Error | Failure["error"]) =>
  error instanceof AgentUnavailable
    ? {
        title: "The assistant is not available",
        description: "Try again in a moment, or open one of the examples.",
      }
    : error instanceof SourceUnavailable
      ? { title: `${named(error.source)} is not responding`, description: "Try again in a moment." }
      : error instanceof TooManyQuestions
        ? {
            title: "Too many questions in a minute",
            description: "You can ask this question again now.",
          }
        : error instanceof ConversationBusy
          ? {
              title: "Still answering an earlier question",
              description: "This conversation is open elsewhere. Ask again once it has answered.",
            }
          : error instanceof CatalogUnavailable
            ? {
                title: "Indicator search is not available",
                description: "Try again in a moment.",
              }
            : { title: "The question could not be sent", description: "Try again in a moment." }

interface ProblemProps {
  error: Error
  dismiss?: () => void
}

// Why the conversation or a question failed, and what to do about it.
export const Problem = ({ error, dismiss }: ProblemProps) => {
  const { title, description } = explain(error)

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {dismiss === undefined ? null : (
        <AlertAction>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss error" onClick={dismiss}>
            <X />
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}

interface FailedQuestionProps {
  failure: Failure
  answering: boolean
  retry: (failure: Failure) => void
}

export const FailedQuestion = ({ failure, answering, retry }: FailedQuestionProps) => {
  const [now, setNow] = useState(Date.now)
  const remaining = Math.max(0, Math.ceil((failure.retryAt - now) / 1000))

  useEffect(() => {
    if (remaining === 0) return undefined

    const timer = window.setTimeout(() => setNow(Date.now()), 1000)

    return () => window.clearTimeout(timer)
  }, [remaining])

  const { title, description } = explain(failure.error)

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {remaining > 0 ? `Ask again in ${remaining} seconds.` : description}
      </AlertDescription>
      {remaining > 0 ? null : (
        <Button
          className="mt-2 w-fit"
          variant="outline"
          size="sm"
          disabled={answering}
          onClick={() => retry(failure)}
        >
          Ask again
        </Button>
      )}
    </Alert>
  )
}
