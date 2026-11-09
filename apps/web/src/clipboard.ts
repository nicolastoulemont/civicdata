import { useState } from "react"

type Outcome = "copied" | "failed"

// Copies text to the clipboard. The outcome shows until `subject`, what the
// text is made from, changes: a link stops saying "copied" once its chart
// changes.
export const useCopy = (subject: string) => {
  const [copied, setCopied] = useState<{ subject: string; outcome: Outcome }>()

  return {
    outcome: copied?.subject === subject ? copied.outcome : undefined,
    copy: (text: string) =>
      void navigator.clipboard.writeText(text).then(
        () => setCopied({ subject, outcome: "copied" }),
        () => setCopied({ subject, outcome: "failed" }),
      ),
  }
}
