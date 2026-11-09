import { AgentUnavailable, type View, SourceUnavailable, TooManyQuestions } from "@civicdata/domain"
import { useMutation } from "@tanstack/react-query"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

import { explain } from "./api.ts"
import { named } from "./format.ts"
import { toQuery } from "./search.ts"

const problemOf = (error: Error) =>
  error instanceof AgentUnavailable
    ? "The assistant is not available"
    : error instanceof TooManyQuestions
      ? "Too many questions in a minute"
      : error instanceof SourceUnavailable
        ? `${named(error.source)} is not responding`
        : "The chart could not be explained"

interface TakeawayProps {
  view: View
}

// The agent's takeaway for the chart on screen, asked for on demand. Edits
// never ask the agent, so after one the takeaway describes an earlier chart:
// it greys out and the button asks again.
export const Takeaway = ({ view }: TakeawayProps) => {
  const explaining = useMutation({ mutationFn: explain })
  const explained = explaining.data
  const takeaway = explained?.takeaway
  const current = explained !== undefined && toQuery(explained.view) === toQuery(view)

  return (
    <section aria-label="Takeaway" className="flex flex-col items-start gap-2">
      {takeaway === undefined ? null : (
        <p className={current ? undefined : "text-muted-foreground"}>{takeaway}</p>
      )}
      {takeaway === undefined || current ? null : (
        <p className="text-sm text-muted-foreground">
          This describes the chart before your changes.
        </p>
      )}
      {current && takeaway === undefined ? (
        <p className="text-sm text-muted-foreground">
          The assistant cited numbers that are not in the data, so its explanation is not shown.
        </p>
      ) : null}
      {current && takeaway !== undefined ? null : (
        <Button
          variant="outline"
          size="sm"
          disabled={explaining.isPending}
          onClick={() => explaining.mutate(view)}
        >
          {explaining.isPending ? <Spinner aria-hidden /> : null}
          Explain this chart
        </Button>
      )}
      {explaining.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{problemOf(explaining.error)}</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
