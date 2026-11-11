import { useEffect, useId } from "react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"

interface ChoicesProps {
  question: string
  choices: ReadonlyArray<string>
  choose: (choice: string) => void
}

// Only mounted for the latest unanswered question. Shortcuts leave editable
// fields alone, so a free-form reply can include numbers.
export const Choices = ({ question, choices, choose }: ChoicesProps) => {
  const heading = useId()

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

      const choice = choices.slice(0, 4)[["1", "2", "3", "4"].indexOf(event.key)]

      if (choice === undefined) return

      event.preventDefault()
      choose(choice)
    }

    document.addEventListener("keydown", onKeyDown)

    return () => document.removeEventListener("keydown", onKeyDown)
  }, [choices, choose])

  return (
    <section
      aria-labelledby={heading}
      className="max-h-[40svh] overflow-y-auto rounded-t-2xl border border-b-0 bg-card p-3"
    >
      <h2 id={heading} className="px-2 pb-2 text-sm font-medium" aria-live="polite">
        {question}
      </h2>
      <div className="flex flex-col gap-1">
        {choices.map((choice, index) => (
          <Button
            key={choice}
            variant="ghost"
            className="h-auto min-h-11 w-full justify-between gap-3 px-2 py-2 text-left whitespace-normal"
            aria-keyshortcuts={index < 4 ? String(index + 1) : undefined}
            onClick={() => choose(choice)}
          >
            <span className="min-w-0 wrap-anywhere">{choice}</span>
            {index < 4 ? (
              <Kbd aria-hidden className="shrink-0">
                {index + 1}
              </Kbd>
            ) : null}
          </Button>
        ))}
      </div>
    </section>
  )
}
