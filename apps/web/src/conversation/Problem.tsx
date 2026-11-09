import {
  AgentUnavailable,
  CatalogUnavailable,
  ConversationBusy,
  SourceUnavailable,
  TooManyQuestions,
} from "@civicdata/domain"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { named } from "@/explore/format"

const explain = (error: Error) =>
  error instanceof AgentUnavailable
    ? {
        title: "The assistant is not available",
        description: "Try again in a moment, or open one of the examples.",
      }
    : error instanceof SourceUnavailable
      ? { title: `${named(error.source)} is not responding`, description: "Try again in a moment." }
      : error instanceof TooManyQuestions
        ? { title: "Too many questions in a minute", description: "Wait a minute, then ask again." }
        : error instanceof ConversationBusy
          ? {
              title: "Still answering an earlier question",
              description: "This conversation is open elsewhere. Ask again once it has answered.",
            }
          : error instanceof CatalogUnavailable
            ? {
                title: "Indicator search is not available",
                description: "It needs D1: run `pnpm dev`, not `pnpm dev:web`.",
              }
            : { title: "The question could not be sent", description: "Try again in a moment." }

interface ProblemProps {
  error: Error
}

// Why the conversation or a question failed, and what to do about it.
export const Problem = ({ error }: ProblemProps) => {
  const { title, description } = explain(error)

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  )
}
