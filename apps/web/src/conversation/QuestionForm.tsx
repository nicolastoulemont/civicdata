import { useState } from "react"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

interface QuestionFormProps {
  label: string
  placeholder: string
  disabled?: boolean
  onAsk: (question: string) => void
}

// A question box. `onAsk` gets the question; the box then empties for the next
// one. While `disabled`, the button cannot send.
export const QuestionForm = ({
  label,
  placeholder,
  disabled = false,
  onAsk,
}: QuestionFormProps) => {
  const [question, setQuestion] = useState("")

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onAsk(question.trim())
        setQuestion("")
      }}
    >
      <Field>
        <FieldLabel htmlFor="question">{label}</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={placeholder}
            required
            minLength={3}
            maxLength={500}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" disabled={disabled}>
              Ask
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </form>
  )
}
