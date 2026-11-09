import { ArrowUp, Square } from "lucide-react"
import { type RefObject, useRef, useState } from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// Whether the box can send: it holds a question, it is empty, or the agent is
// still answering the last one.
type State = "ready" | "empty" | "answering"

// The answer in progress, which the composer can stop.
export interface Answering {
  readonly stop: () => void
  readonly stopping: boolean
}

const reasons = {
  empty: "Type a question to send",
  answering: "Wait for the answer to send another question",
} as const

interface SendProps {
  state: State
}

// The round send button. While it cannot send, its name and tooltip say why,
// and it stays focusable so keyboard users can read that tooltip too.
const Send = ({ state }: SendProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <InputGroupButton
          type="submit"
          variant="default"
          size="icon-sm"
          className="rounded-full aria-disabled:bg-muted aria-disabled:text-muted-foreground"
          aria-label={state === "ready" ? "Send" : reasons[state]}
          disabled={state !== "ready"}
          focusableWhenDisabled
        />
      }
    >
      <ArrowUp aria-hidden />
    </TooltipTrigger>
    <TooltipContent>
      {state === "ready" ? (
        <>
          Send <Kbd>Enter</Kbd>
        </>
      ) : (
        reasons[state]
      )}
    </TooltipContent>
  </Tooltip>
)

interface StopProps {
  answering: Answering
  box: RefObject<HTMLTextAreaElement | null>
}

// The round stop button that takes the send button's place while the agent
// answers and the box is empty. Stopping moves focus to the box, ready for the
// next question, since the button goes away once the answer stops.
const Stop = ({ answering, box }: StopProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <InputGroupButton
          variant="destructive"
          size="icon-sm"
          className="rounded-full"
          aria-label="Stop"
          disabled={answering.stopping}
          onClick={() => {
            answering.stop()
            box.current?.focus()
          }}
        />
      }
    >
      <Square aria-hidden className="size-3 fill-current" />
    </TooltipTrigger>
    <TooltipContent>Stop the answer</TooltipContent>
  </Tooltip>
)

interface QuestionFormProps {
  label: string
  placeholder: string
  answering?: Answering | undefined
  onAsk: (question: string) => void
}

// The composer: a card whose box grows with the question, up to 13rem, then
// scrolls. Enter sends and Shift+Enter starts a new line. `onAsk` gets the
// question and the box empties for the next one. While `answering`, the box
// takes a draft but cannot send it, and an empty box offers to stop the answer.
export const QuestionForm = ({ label, placeholder, answering, onAsk }: QuestionFormProps) => {
  const [question, setQuestion] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)
  const empty = question.trim() === ""
  const state: State = answering === undefined ? (empty ? "empty" : "ready") : "answering"

  return (
    <form
      className="[view-transition-name:composer]"
      onSubmit={(event) => {
        event.preventDefault()

        if (state !== "ready") return

        onAsk(question.trim())
        setQuestion("")
      }}
    >
      <InputGroup className="rounded-2xl bg-card/80 shadow-sm backdrop-blur-md dark:bg-card/80 dark:shadow-none">
        <InputGroupTextarea
          ref={box}
          aria-label={label}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return

            event.preventDefault()

            // Submitting through the form checks the 3 to 500 character limit.
            if (state === "ready") event.currentTarget.form?.requestSubmit()
          }}
          placeholder={placeholder}
          required
          minLength={3}
          maxLength={500}
          className="max-h-52 min-h-12 px-4 pt-3"
        />
        <InputGroupAddon align="block-end" className="justify-end px-3 pb-3">
          {answering !== undefined && empty ? (
            <Stop answering={answering} box={box} />
          ) : (
            <Send state={state} />
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
