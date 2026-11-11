import { Toolbar } from "@base-ui/react/toolbar"
/*
 * The tick styling and the tick widths by distance from the pointed tick are
 * copied from T3 Code's TimelineMinimap.tsx (https://github.com/pingdotgg/t3code).
 *
 * MIT License
 *
 * Copyright (c) 2026 T3 Tools Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { cn } from "cn"
import { ChevronDown, ChevronUp } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

import type { Preview, Seen } from "./rail.ts"

// How wide a tick grows by its distance from the pointed one: in full under
// the pointer, less for its neighbours, a third for the rest.
const reach = ["scale-x-100", "scale-x-[0.667]", "scale-x-[0.417]"] as const

interface StepProps {
  label: string
  to: number | undefined
  jump: (index: number) => void
  children: ReactNode
}

// The button to the previous or next question, shown while the rail is
// pointed at or holds keyboard focus. The wrapper hides it, so a disabled
// button keeps its own dimmed look once shown.
const Step = ({ label, to, jump, children }: StepProps) => (
  <div className="flex opacity-0 group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100">
    <Toolbar.Button
      render={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={to === undefined}
          onClick={() => {
            if (to !== undefined) jump(to)
          }}
        />
      }
    >
      {children}
    </Toolbar.Button>
  </div>
)

interface RailProps {
  previews: ReadonlyArray<Preview>
  seen: Seen
  jump: (index: number) => void
}

// One tick per question beside the conversation, after T3 Code's timeline
// minimap. Each question in view has the stronger tick, and the first of them
// is the current one, which the previous and next buttons step from. Pointing
// at a tick, or moving to it with the arrow keys, widens it and its neighbours
// and shows the question with the start of its answer; activating it jumps
// there. The rail takes one Tab stop. It shows from two questions, where the
// lane leaves room beside it.
export const Rail = ({ previews, seen, jump }: RailProps) => {
  const { t } = useTranslation("conversation")

  const [pointed, setPointed] = useState<number>()
  const current = seen.first

  if (previews.length < 2) return null

  return (
    <TooltipProvider>
      <Toolbar.Root
        orientation="vertical"
        aria-label={t(($) => $["Questions"])}
        className="group/rail absolute top-1/2 left-3 z-20 hidden -translate-y-1/2 flex-col items-center @min-[52rem]:flex"
        onMouseLeave={() => setPointed(undefined)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPointed(undefined)
        }}
      >
        <Step
          label={t(($) => $["Previous question"])}
          to={current > 0 ? current - 1 : undefined}
          jump={jump}
        >
          <ChevronUp aria-hidden />
        </Step>
        <div className="flex max-h-[calc(100svh-18rem)] flex-col py-1">
          {previews.map(({ question, answer }, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a question keeps its place in the conversation
            <Tooltip key={index}>
              <TooltipTrigger
                render={
                  <Toolbar.Button
                    render={
                      <Button
                        variant="ghost"
                        className="h-2 min-h-0 w-8 shrink justify-start rounded-none border-0 px-1 hover:bg-transparent focus-visible:ring-2 aria-expanded:bg-transparent dark:hover:bg-transparent"
                        aria-label={t(($) => $["Jump to question: {{question}}"], {
                          question: question,
                        })}
                        aria-current={index === current ? "location" : undefined}
                        onMouseEnter={() => setPointed(index)}
                        onFocus={() => setPointed(index)}
                        onClick={() => jump(index)}
                      />
                    }
                  />
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 w-6 origin-left rounded-full transition-transform duration-150 motion-reduce:transition-none",
                    index >= seen.first && index <= seen.last
                      ? "bg-foreground/60"
                      : "bg-muted-foreground/30",
                    pointed === undefined
                      ? "scale-x-[0.333]"
                      : (reach[Math.abs(index - pointed)] ?? "scale-x-[0.333]"),
                  )}
                />
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={8}
                className="w-80 max-w-80 flex-col items-start gap-1 bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 *:data-side:bg-popover *:data-side:fill-popover"
              >
                <span className="w-full truncate font-medium">{question}</span>
                {answer === undefined ? null : (
                  <span className="line-clamp-3 text-muted-foreground">{answer}</span>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <Step
          label={t(($) => $["Next question"])}
          to={current < previews.length - 1 ? current + 1 : undefined}
          jump={jump}
        >
          <ChevronDown aria-hidden />
        </Step>
      </Toolbar.Root>
    </TooltipProvider>
  )
}
