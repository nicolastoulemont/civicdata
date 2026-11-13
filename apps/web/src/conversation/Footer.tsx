import { Asked, type ConversationId, Stopped, type Turn, type TurnIndex } from "@repo/domain"
import { DateTime, Schema } from "effect"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Actions, Copy } from "./Row.tsx"
import { Vote } from "./Vote.tsx"
import { wordsOf } from "./words.ts"

const isAsked = Schema.is(Asked)

const isStopped = Schema.is(Stopped)

interface TimeProps {
  turn: Turn
}

// When the answer ended: the time alone on the day it ended, with the date
// after. A turn saved before turns kept their start shows none.
const Time = ({ turn }: TimeProps) => {
  const { i18n } = useTranslation()
  const [today] = useState(() => new Date().toDateString())

  if (turn.started === undefined) return null

  const ended =
    turn.took === undefined ? turn.started : DateTime.addDuration(turn.started, turn.took)

  const date = DateTime.toDateUtc(ended)
  const sameDay = date.toDateString() === today

  const text = new Intl.DateTimeFormat(
    i18n.language,
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(date)

  return (
    <time dateTime={DateTime.formatIso(ended)} className="px-1 text-xs text-muted-foreground">
      {text}
    </time>
  )
}

interface FooterProps {
  id: ConversationId
  index: TurnIndex
  turn: Turn
}

// The row under a kept answer, on its right: when it ended, a button that
// copies its words, if it has any, and, for an answer that ended on its own
// rather than with a question back or a stop, whether it was useful.
export const Footer = ({ id, index, turn }: FooterProps) => {
  const { t } = useTranslation("conversation")
  const words = wordsOf(turn.answer)

  const actions = (
    <>
      <Time turn={turn} />
      {words === "" ? null : <Copy text={words} label={t(($) => $["Copy answer"])} />}
    </>
  )

  return isAsked(turn.answer) || isStopped(turn.answer) ? (
    <Actions className="justify-end">{actions}</Actions>
  ) : (
    <Vote id={id} turn={index} vote={turn.vote}>
      {actions}
    </Vote>
  )
}
