import { Check, Copy } from "lucide-react"

import { useCopy } from "@/clipboard"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { Actions, Author } from "./Row.tsx"

const labels = { copied: "Copied", failed: "Could not copy" } as const

interface CopyQuestionProps {
  text: string
}

const CopyQuestion = ({ text }: CopyQuestionProps) => {
  const { outcome, copy } = useCopy(text)
  const label = outcome === undefined ? "Copy question" : labels[outcome]

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label={label} onClick={() => copy(text)} />
        }
      >
        {outcome === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface QuestionProps {
  text: string
}

// A question the visitor asked: a bubble on the right of the lane.
export const Question = ({ text }: QuestionProps) => (
  <div className="group flex flex-col items-end gap-1">
    <Author>You</Author>
    <p className="max-w-4/5 min-w-0 rounded-2xl bg-message-surface px-4 py-3 wrap-break-word whitespace-pre-wrap">
      {text}
    </p>
    <Actions>
      <CopyQuestion text={text} />
    </Actions>
  </div>
)
