import { ArrowUp } from "lucide-react"
import { useState } from "react"

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

interface QuestionFormProps {
  label: string
  placeholder: string
  answering?: boolean
  onAsk: (question: string) => void
}

// The composer: a card whose box grows with the question, up to 13rem, then
// scrolls. Enter sends and Shift+Enter starts a new line. `onAsk` gets the
// question and the box empties for the next one. While `answering`, the box
// takes a draft but cannot send it.
export const QuestionForm = ({
  label,
  placeholder,
  answering = false,
  onAsk,
}: QuestionFormProps) => {
  const [question, setQuestion] = useState("")
  const state: State = answering ? "answering" : question.trim() === "" ? "empty" : "ready"

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
          <Send state={state} />
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
