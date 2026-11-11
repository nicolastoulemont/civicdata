import {
  AgentUnavailable,
  type Explanation,
  type View,
  SourceUnavailable,
  TooManyQuestions,
} from "@civicdata/domain"
import { useMutation } from "@tanstack/react-query"
import { Data, Match } from "effect"
import type { TFunction } from "i18next"
import { use } from "react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Hold } from "@/hold"

import { explain } from "./api.ts"
import { named as englishNamed } from "./format.ts"
import { Prose } from "./Prose.tsx"
import { toQuery } from "./search.ts"

const problemOf = (error: Error, t: TFunction<"explore">) =>
  error instanceof AgentUnavailable
    ? t(($) => $["The assistant is not available"])
    : error instanceof TooManyQuestions
      ? t(($) => $["Too many questions in a minute"])
      : error instanceof SourceUnavailable
        ? t(($) => $["{{value1}} is not responding"], { value1: englishNamed(error.source) })
        : t(($) => $["The chart could not be explained"])

// What the agent said about the chart on screen when asked: nothing yet, an
// explanation of it, or one of the chart before the person's changes.
type Said = Data.TaggedEnum<{
  Nothing: {}
  Current: { readonly text: string }
  Earlier: { readonly text: string }
}>

const Said = Data.taggedEnum<Said>()

const saidOf = (view: View, explained: Explanation | undefined): Said => {
  if (explained === undefined) return Said.Nothing()

  return toQuery(explained.view) === toQuery(view)
    ? Said.Current({ text: explained.text })
    : Said.Earlier({ text: explained.text })
}

interface TextProps {
  said: Said
}

const Text = ({ said }: TextProps) => {
  const { t } = useTranslation("explore")

  return Match.valueTags(said, {
    Nothing: () => null,
    Current: ({ text }) => <Prose text={text} />,
    Earlier: ({ text }) => (
      <>
        <Prose text={text} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t(($) => $["This describes the chart before your changes."])}
        </p>
      </>
    ),
  })
}

interface TakeawayProps {
  view: View
  // The chart the agent answered a question with, in a conversation.
  agent: View | undefined
  onChange: (view: View) => void
}

// What the agent says the chart on screen shows, asked for on demand.
// Changes never ask the agent, so after one the explanation describes an
// earlier chart: it greys out and the button asks again, while a failed
// request's alert goes, since it was about that chart. In a conversation,
// the agent's own chart needs none: its answer says what the chart shows. A
// chart changed from it can go back to it.
export const Takeaway = ({ view, agent, onChange }: TakeawayProps) => {
  const { t } = useTranslation("explore")

  const hold = use(Hold)
  const explaining = useMutation({ mutationFn: explain })

  if (agent !== undefined && toQuery(agent) === toQuery(view)) return null

  const said = saidOf(view, explaining.data)

  // A request for an earlier chart says nothing about the one on screen.
  const failed = explaining.isError && toQuery(explaining.variables) === toQuery(view)

  return (
    <section aria-label={t(($) => $["Takeaway"])} className="flex flex-col items-start gap-2">
      <Text said={said} />
      <div className="flex flex-wrap gap-2 empty:hidden">
        {Said.$is("Current")(said) ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={explaining.isPending}
            onClick={() => {
              hold()
              explaining.mutate(view)
            }}
          >
            {t(($) => $["{{value}} Explain this chart"], {
              value: explaining.isPending ? <Spinner aria-hidden /> : null,
            })}
          </Button>
        )}
        {agent === undefined ? null : (
          <Button variant="outline" size="sm" onClick={() => onChange(agent)}>
            {t(($) => $["Back to the agent's chart"])}
          </Button>
        )}
      </div>
      {failed ? (
        <Alert variant="destructive">
          <AlertTitle>{problemOf(explaining.error, t)}</AlertTitle>
          <AlertDescription>{t(($) => $["Try again in a moment."])}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
