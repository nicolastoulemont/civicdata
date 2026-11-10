import { ArrowDown } from "lucide-react"
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Hold } from "@/hold"

import { type Follow, followScroll } from "./scroll.ts"

interface ScrollProps {
  children: ReactNode
  composer: ReactNode
  anchor: string | undefined
}

// The composer is docked at the end of the content and sticks to the bottom
// of the viewport, so rows scroll under it and the last one still ends above
// it, however tall the composer grows. The scroll button rides on top of it.
export const Scroll = ({ children, composer, anchor }: ScrollProps) => {
  const viewport = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const follow = useRef<Follow>("following")
  const previous = useRef(0)
  const [mode, setMode] = useState<Follow>("following")

  const change = useCallback((next: Follow) => {
    follow.current = next
    setMode(next)
  }, [])

  const hold = useCallback(() => change("stopped"), [change])

  const end = (behavior: ScrollBehavior) => {
    const node = viewport.current

    if (node === null) return
    node.scrollTo({ top: node.scrollHeight, behavior })
    previous.current = node.scrollTop
  }

  useLayoutEffect(() => {
    const node = viewport.current
    const rows = content.current

    if (node === null || rows === null) return undefined

    const followEnd = () => {
      // With nothing to scroll, there is no end to return to.
      if (follow.current !== "following") {
        if (node.scrollHeight <= node.clientHeight) change("following")

        return
      }

      node.scrollTo({ top: node.scrollHeight, behavior: "instant" })
      previous.current = node.scrollTop
    }

    const observer = new ResizeObserver(followEnd)
    observer.observe(node)
    observer.observe(rows)
    followEnd()

    return () => observer.disconnect()
  }, [change])

  useLayoutEffect(() => {
    if (anchor === undefined) return undefined
    const node = viewport.current
    const below = dock.current
    const question = content.current?.querySelector("[data-scroll-anchor]")

    if (node === null || below === null || !(question instanceof HTMLElement)) return undefined

    change("following")

    // Reserve the viewport above the composer until the first work arrives.
    // The new question then sits 24px from the top, even in a short thread:
    // 56px is the rows' padding, 24px above them and 32px below.
    const size = () => {
      question.style.minHeight = `${Math.max(0, node.clientHeight - below.offsetHeight - 56)}px`

      if (follow.current !== "following") return
      node.scrollTo({ top: node.scrollHeight, behavior: "instant" })
      previous.current = node.scrollTop
    }

    size()
    const observer = new ResizeObserver(size)
    observer.observe(node)
    observer.observe(below)

    return () => {
      observer.disconnect()
      question.style.minHeight = ""
    }
  }, [anchor, change])

  return (
    <section
      ref={viewport}
      aria-label="Conversation"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard readers must be able to focus and scroll the viewport
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      onScroll={(event) => {
        const node = event.currentTarget

        const position = {
          top: node.scrollTop,
          height: node.clientHeight,
          content: node.scrollHeight,
          previous: previous.current,
        }

        change(followScroll(follow.current, position))
        previous.current = node.scrollTop
      }}
      onWheel={(event) => {
        if (event.deltaY < 0 && event.currentTarget.scrollTop > 0) change("stopped")
      }}
    >
      <div ref={content} className="flex min-h-full flex-col">
        {/* Its own stacking context: nothing a row raises can cover the composer. */}
        <div className="isolate pt-6 pb-8">
          <Hold value={hold}>{children}</Hold>
        </div>
        <div
          ref={dock}
          className="sticky bottom-0 z-10 mt-auto bg-background before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-linear-to-t before:from-background"
        >
          {mode === "stopped" ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-full mb-3 flex justify-center">
              <Button
                variant="outline"
                size="icon-lg"
                className="pointer-events-auto rounded-full bg-background shadow-sm motion-reduce:transition-none"
                aria-label="Scroll to end"
                title="Scroll to end"
                onClick={() => {
                  change("following")
                  end(
                    window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "instant"
                      : "smooth",
                  )
                  viewport.current?.focus({ preventScroll: true })
                }}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
            </div>
          ) : null}
          {composer}
        </div>
      </div>
    </section>
  )
}
