import { type ReactNode, useEffect, useId, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"

const keys = ["1", "2", "3", "4"]

// Calls `press` with the choice whose number key the person pressed. Only
// the first four choices have one. Shortcuts leave editable fields alone, so
// a free-form reply can include numbers.
const useNumbers = (choices: ReadonlyArray<string>, press: (choice: string) => void) =>
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        [event.altKey, event.ctrlKey, event.metaKey, event.shiftKey].includes(true) ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          ))
      )
        return

      const choice = choices.slice(0, keys.length)[keys.indexOf(event.key)]

      if (choice === undefined) return

      event.preventDefault()
      press(choice)
    }

    document.addEventListener("keydown", onKeyDown)

    return () => document.removeEventListener("keydown", onKeyDown)
  }, [choices, press])

interface NumberKeyProps {
  index: number
}

const NumberKey = ({ index }: NumberKeyProps) =>
  index < keys.length ? (
    <Kbd aria-hidden className="shrink-0">
      {index + 1}
    </Kbd>
  ) : null

interface PanelProps {
  question: string
  children: ReactNode
}

const Panel = ({ question, children }: PanelProps) => {
  const heading = useId()

  return (
    <section
      aria-labelledby={heading}
      className="max-h-[40svh] overflow-y-auto rounded-t-2xl border border-b-0 bg-card p-3"
    >
      <h2 id={heading} className="px-2 pb-2 text-sm font-medium" aria-live="polite">
        {question}
      </h2>
      {children}
    </section>
  )
}

interface OneChoiceProps {
  question: string
  choices: ReadonlyArray<string>
  choose: (reply: string) => void
}

// The agent's question when its choices exclude each other: a choice sends
// itself as the reply. Only mounted for the latest unanswered question.
export const OneChoice = ({ question, choices, choose }: OneChoiceProps) => {
  useNumbers(choices, choose)

  return (
    <Panel question={question}>
      <div className="flex flex-col gap-1">
        {choices.map((choice, index) => (
          <Button
            key={choice}
            variant="ghost"
            className="h-auto min-h-11 w-full justify-between gap-3 px-2 py-2 text-left whitespace-normal"
            aria-keyshortcuts={index < keys.length ? keys[index] : undefined}
            onClick={() => choose(choice)}
          >
            <span className="min-w-0 wrap-anywhere">{choice}</span>
            <NumberKey index={index} />
          </Button>
        ))}
      </div>
    </Panel>
  )
}

interface SeveralChoicesProps {
  question: string
  choices: ReadonlyArray<string>
  choose: (reply: string) => void
}

// The agent's question when the person may pick several choices: a choice
// or its number key ticks it, and Send replies with the ticked ones as a
// list in the choices' order, e.g. "Mexico and Peru". Only mounted for the
// latest unanswered question.
export const SeveralChoices = ({ question, choices, choose }: SeveralChoicesProps) => {
  const { t, i18n } = useTranslation("conversation")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const tick = (choice: string) =>
    setPicked((before) => {
      const after = new Set(before)

      if (!after.delete(choice)) after.add(choice)

      return after
    })

  useNumbers(choices, tick)

  const send = () =>
    choose(
      new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(
        choices.filter((choice) => picked.has(choice)),
      ),
    )

  return (
    <Panel question={question}>
      <div className="flex flex-col gap-1">
        {choices.map((choice, index) => (
          <Label
            key={choice}
            className="min-h-11 cursor-pointer gap-3 rounded-lg px-2 py-2 font-normal hover:bg-muted"
          >
            <Checkbox
              checked={picked.has(choice)}
              onCheckedChange={() => tick(choice)}
              aria-keyshortcuts={index < keys.length ? keys[index] : undefined}
            />
            <span className="min-w-0 flex-1 leading-snug wrap-anywhere">{choice}</span>
            <NumberKey index={index} />
          </Label>
        ))}
      </div>
      <div className="flex justify-end px-2 pt-2">
        <Button size="sm" disabled={picked.size === 0} onClick={send}>
          {t(($) => $["Send choices"])}
        </Button>
      </div>
    </Panel>
  )
}
