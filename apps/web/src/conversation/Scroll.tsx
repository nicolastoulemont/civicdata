import { ArrowDown } from "lucide-react"
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

import { type Follow, followScroll } from "./scroll.ts"

interface ScrollProps {
  children: ReactNode
  anchor: string | undefined
}

// The composer sits outside this viewport, so its panels can grow without
// hiding the end or sharing space with the scroll button.
export const Scroll = ({ children, anchor }: ScrollProps) => {
  const viewport = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const follow = useRef<Follow>("following")
  const previous = useRef(0)
  const [mode, setMode] = useState<Follow>("following")

  const change = useCallback((next: Follow) => {
    follow.current = next
    setMode(next)
  }, [])

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
      if (follow.current !== "following") return
      node.scrollTo({ top: node.scrollHeight, behavior: "instant" })
      previous.current = node.scrollTop
    }

    const observer = new ResizeObserver(followEnd)
    observer.observe(node)
    observer.observe(rows)
    followEnd()

    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (anchor === undefined) return undefined
    const node = viewport.current
    const question = content.current?.querySelector("[data-scroll-anchor]")

    if (node === null || !(question instanceof HTMLElement)) return undefined

    change("following")

    // Reserve the remainder of the viewport until the first work arrives.
    // The new question then sits 24px from the top, even in a short thread.
    const size = () => {
      question.style.minHeight = `${Math.max(0, node.clientHeight - 48)}px`

      if (follow.current !== "following") return
      node.scrollTo({ top: node.scrollHeight, behavior: "instant" })
      previous.current = node.scrollTop
    }

    size()
    const observer = new ResizeObserver(size)
    observer.observe(node)

    return () => {
      observer.disconnect()
      question.style.minHeight = ""
    }
  }, [anchor, change])

  return (
    <div className="relative min-h-0 flex-1">
      <section
        ref={viewport}
        aria-label="Conversation"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard readers must be able to focus and scroll the viewport
        tabIndex={0}
        className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
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
        <div ref={content} className="py-6">
          {children}
        </div>
      </section>
      {mode === "stopped" ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
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
    </div>
  )
}
