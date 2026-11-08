import {
  AgentUnavailable,
  CatalogUnavailable,
  NoChart,
  SourceUnavailable,
  TooManyQuestions,
  type View,
} from "@civicdata/domain"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ask } from "@/explore/api"

const explain = (error: Error) =>
  error instanceof NoChart
    ? {
        title: "No chart answers that question",
        description:
          "Name what to measure and where, like “GDP per person in France and Germany since 2000”.",
      }
    : error instanceof AgentUnavailable
      ? {
          title: "The assistant is not available",
          description: "Try again in a moment, or open one of the examples.",
        }
      : error instanceof SourceUnavailable
        ? { title: "The World Bank is not responding", description: "Try again in a moment." }
        : error instanceof TooManyQuestions
          ? {
              title: "Too many questions in a minute",
              description: "Wait a minute, then ask again.",
            }
          : error instanceof CatalogUnavailable
            ? {
                title: "Indicator search is not available",
                description: "It needs D1: run `pnpm dev`, not `pnpm dev:web`.",
              }
            : { title: "The question could not be sent", description: "Try again in a moment." }

// A question box. The agent answers with a View, which `onAnswer` opens.
export const Ask = ({ onAnswer }: { onAnswer: (view: View) => void }) => {
  const [question, setQuestion] = useState("")
  const asking = useMutation({ mutationFn: ask, onSuccess: onAnswer })
  const problem = asking.isError ? explain(asking.error) : undefined

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        asking.mutate(question.trim())
      }}
    >
      <Field>
        <FieldLabel htmlFor="question">Ask about a country</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="How has life expectancy changed in Brazil?"
            required
            minLength={3}
            maxLength={500}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" disabled={asking.isPending}>
              {asking.isPending ? "Finding a chart…" : "Ask"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
      {problem === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>{problem.title}</AlertTitle>
          <AlertDescription>{problem.description}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}
