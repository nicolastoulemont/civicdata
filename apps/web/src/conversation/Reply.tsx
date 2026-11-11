import type { Ending } from "@civicdata/domain"
import { Match } from "effect"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface ReplyProps {
  answer: Ending
}

// What follows the blocks of an answer: nothing, a question back, why the
// agent found no chart, or that the agent reached its limit or the person
// stopped it.
export const Reply = ({ answer }: ReplyProps) => {
  const { t } = useTranslation("conversation")

  return Match.valueTags(answer, {
    Answered: () => null,
    Asked: ({ question }) => <p>{question}</p>,
    Unanswered: () => (
      <Alert>
        <AlertTitle>{t(($) => $["No World Bank indicator answers this question"])}</AlertTitle>
        <AlertDescription>
          {t(
            ($) =>
              $[
                "Name what to measure and where, like “GDP per person in France and Germany since 2000”."
              ],
          )}
        </AlertDescription>
      </Alert>
    ),
    Exhausted: () => (
      <p className="text-sm text-muted-foreground">
        {t(
          ($) =>
            $["Cut short: openfacts reached its limit of steps before it finished this answer"],
        )}
      </p>
    ),
    Stopped: () => <p className="text-sm text-muted-foreground">{t(($) => $["You stopped"])}</p>,
  })
}
