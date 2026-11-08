import {
  AgentUnavailable,
  CatalogUnavailable,
  ConversationBusy,
  type ConversationId,
  SourceUnavailable,
  type Step,
  TooManyQuestions,
  type Turn,
} from "@civicdata/domain"
import { Link } from "@tanstack/react-router"
import { Match } from "effect"
import { useEffect, useRef } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

import { Answer } from "./Answer.tsx"
import { QuestionForm } from "./QuestionForm.tsx"
import { useConversation } from "./useConversation.ts"

const explain = (error: Error) =>
  error instanceof AgentUnavailable
    ? {
        title: "The assistant is not available",
        description: "Try again in a moment, or open one of the examples.",
      }
    : error instanceof SourceUnavailable
      ? { title: "The World Bank is not responding", description: "Try again in a moment." }
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

const Problem = ({ error }: { error: Error }) => {
  const { title, description } = explain(error)

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  )
}

const describe = (step: Step) =>
  Match.valueTags(step, {
    Searched: ({ text }) => `Searched indicators for “${text}”`,
    Rejected: ({ problem }) => `Tried a chart the data cannot show: ${problem}`,
    Answered: () => "Found a chart",
    Unanswered: () => "Found no indicator",
  })

const Question = ({ text }: { text: string }) => (
  <p className="self-end rounded-lg bg-muted px-3 py-2">{text}</p>
)

const TurnItem = ({ turn }: { turn: Turn }) => (
  <li className="flex flex-col gap-3">
    <Question text={turn.question} />
    {turn.view === null ? (
      <Alert>
        <AlertTitle>No World Bank indicator answers this question</AlertTitle>
        <AlertDescription>
          Name what to measure and where, like “GDP per person in France and Germany since 2000”.
        </AlertDescription>
      </Alert>
    ) : (
      <Answer view={turn.view} />
    )}
  </li>
)

// A conversation with the agent, newest question last. `first` is a question
// to ask as soon as the conversation opens: the one typed on the home page.
export const Conversation = ({ id, first }: { id: ConversationId; first: string | undefined }) => {
  const { turns, asked, answering, ask } = useConversation(id)
  const sent = useRef(false)

  useEffect(() => {
    if (first === undefined || sent.current) return

    sent.current = true
    ask(first)
  }, [first, ask])

  const empty = turns.data?.length === 0 && asked === undefined && first === undefined

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-medium">Conversation</h1>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} to="/">
          New conversation
        </Link>
      </header>
      {turns.isError ? <Problem error={turns.error} /> : null}
      {empty ? (
        <p className="text-muted-foreground">
          No questions yet. A conversation is deleted 30 days after its last question.
        </p>
      ) : null}
      <ol className="flex flex-col gap-6">
        {(turns.data ?? []).map((turn, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- turns are only appended, so a position never changes meaning
          <TurnItem key={index} turn={turn} />
        ))}
        {asked === undefined ? null : (
          <li className="flex flex-col gap-3">
            <Question text={asked.question} />
            <ol aria-live="polite" className="flex flex-col gap-1 text-sm text-muted-foreground">
              {asked.steps.map((step, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- steps are only appended
                <li key={index}>{describe(step)}</li>
              ))}
              {answering ? (
                <li className="flex items-center gap-2">
                  <Spinner aria-hidden />
                  Finding a chart…
                </li>
              ) : null}
            </ol>
            {asked.error === undefined ? null : <Problem error={asked.error} />}
          </li>
        )}
      </ol>
      <QuestionForm
        label="Ask a follow-up"
        placeholder="Add Mexico, or show it per person"
        disabled={answering}
        onAsk={ask}
      />
    </main>
  )
}
