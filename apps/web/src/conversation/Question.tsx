import { useTranslation } from "react-i18next"

import { Actions, Author, Copy } from "./Row.tsx"

interface QuestionProps {
  text: string
}

// A question the visitor asked: a bubble on the right of the lane.
export const Question = ({ text }: QuestionProps) => {
  const { t } = useTranslation("conversation")

  return (
    <div className="group flex flex-col items-end gap-1">
      <Author>{t(($) => $["You"])}</Author>
      <p className="max-w-4/5 min-w-0 rounded-2xl bg-message-surface px-4 py-3 wrap-break-word whitespace-pre-wrap">
        {text}
      </p>
      <Actions>
        <Copy text={text} label={t(($) => $["Copy question"])} />
      </Actions>
    </div>
  )
}
