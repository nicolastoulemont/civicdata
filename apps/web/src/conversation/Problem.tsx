import {
  AgentUnavailable,
  CatalogUnavailable,
  ConversationBusy,
  TooManyQuestions,
} from "@civicdata/domain"
import type { TFunction } from "i18next"
import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

import { AnswerLost, type Failure } from "./useConversation.ts"

export const explain = (error: Error | Failure["error"], t: TFunction<"conversation">) => {
  if (error instanceof AgentUnavailable) {
    return {
      title: t(($) => $["The assistant is not available"]),
      description: t(($) => $["Try again in a moment, or open one of the examples."]),
    }
  }

  if (error instanceof TooManyQuestions) {
    return {
      title: t(($) => $["Too many questions in a minute"]),
      description: t(($) => $["You can ask this question again now."]),
    }
  }

  if (error instanceof ConversationBusy) {
    return {
      title: t(($) => $["Still answering an earlier question"]),
      description: t(
        ($) => $["This conversation is open elsewhere. Ask again once it has answered."],
      ),
    }
  }

  if (error instanceof CatalogUnavailable) {
    return {
      title: t(($) => $["Indicator search is not available"]),
      description: t(($) => $["Try again in a moment."]),
    }
  }

  if (error instanceof AnswerLost) {
    return {
      title: t(($) => $["The answer was cut off"]),
      description: t(($) => $["The server restarted before it finished answering."]),
    }
  }

  return {
    title: t(($) => $["The question could not be sent"]),
    description: t(($) => $["Try again in a moment."]),
  }
}

interface ProblemProps {
  error: Error
  dismiss?: () => void
}

// Why the conversation or a question failed, and what to do about it.
export const Problem = ({ error, dismiss }: ProblemProps) => {
  const { t } = useTranslation("conversation")

  const { title, description } = explain(error, t)

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {dismiss === undefined ? null : (
        <AlertAction>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t(($) => $["Dismiss error"])}
            onClick={dismiss}
          >
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
  const { t } = useTranslation("conversation")

  const [now, setNow] = useState(Date.now)
  const remaining = Math.max(0, Math.ceil((failure.retryAt - now) / 1000))

  useEffect(() => {
    if (remaining === 0) return undefined

    const timer = window.setTimeout(() => setNow(Date.now()), 1000)

    return () => window.clearTimeout(timer)
  }, [remaining])

  const { title, description } = explain(failure.error, t)

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {remaining > 0 ? t(($) => $.retryIn, { count: remaining }) : description}
      </AlertDescription>
      {remaining > 0 ? null : (
        <Button
          className="mt-2 w-fit"
          variant="outline"
          size="sm"
          disabled={answering}
          onClick={() => retry(failure)}
        >
          {t(($) => $["Ask again"])}
        </Button>
      )}
    </Alert>
  )
}

// Why the answer in progress was not stopped: the stop could not be sent. The
// stop button is back, so the reader can send it again.
export const Unstopped = () => {
  const { t } = useTranslation("conversation")

  return (
    <Alert variant="destructive">
      <AlertTitle>{t(($) => $["The answer could not be stopped"])}</AlertTitle>
      <AlertDescription>{t(($) => $["Stop it again, or wait for it to end."])}</AlertDescription>
    </Alert>
  )
}
