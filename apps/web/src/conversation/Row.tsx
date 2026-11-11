import { cn } from "cn"
import { Check, Copy as CopyIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { useCopy } from "@/clipboard"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface AuthorProps {
  children: string
}

// Who wrote a row. Sighted readers tell by the layout; screen readers jump
// between rows by these headings.
export const Author = ({ children }: AuthorProps) => <h2 className="sr-only">{children}</h2>

interface ActionsProps {
  children: ReactNode
  className?: string
}

// A row's buttons. They fade in while the row is hovered or holds focus, and
// stay visible on touch screens, which cannot hover.
export const Actions = ({ children, className }: ActionsProps) => (
  <div
    className={cn(
      "flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
      className,
    )}
  >
    {children}
  </div>
)

interface CopyProps {
  text: string
  label: string
}

// Copies `text`, then says whether it did until the text changes.
export const Copy = ({ text, label }: CopyProps) => {
  const { t } = useTranslation("conversation")
  const outcomes = { copied: t(($) => $["Copied"]), failed: t(($) => $["Could not copy"]) }
  const { outcome, copy } = useCopy(text)
  const name = outcome === undefined ? label : outcomes[outcome]

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label={name} onClick={() => copy(text)} />
        }
      >
        {outcome === "copied" ? <Check aria-hidden /> : <CopyIcon aria-hidden />}
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}

interface AgentProps {
  children: ReactNode
}

// The agent's row: no bubble and no avatar, the full width of the lane.
export const Agent = ({ children }: AgentProps) => (
  <div className="group flex min-w-0 flex-col gap-3">
    <Author>openfacts</Author>
    {children}
  </div>
)
