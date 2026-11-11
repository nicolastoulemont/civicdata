import { ChevronDown } from "lucide-react"
import {
  type ReactNode,
  type RefObject,
  type UIEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Hold } from "@/hold"

import { inView, type Preview, type Seen } from "./rail.ts"
import { Rail } from "./Rail.tsx"
import { atEnd, type Follow, followScroll } from "./scroll.ts"

const same = (left: Seen, right: Seen) => left.first === right.first && left.last === right.last

const useSeen = (
  viewport: RefObject<HTMLElement | null>,
  dock: RefObject<HTMLDivElement | null>,
) => {
  const [seen, setSeen] = useState<Seen>({ first: 0, last: 0 })

  // Which questions are in view, measured above the composer. A scroll that
  // keeps the same questions in view keeps the state, so the rail does not
  // render again.
  const locate = useCallback(() => {
    const node = viewport.current
    const below = dock.current

    if (node === null || below === null) return

    const top = node.getBoundingClientRect().top

    const tops = [...node.querySelectorAll("[data-question]")].map(
      (question) => question.getBoundingClientRect().top - top,
    )

    const next = inView(tops, node.clientHeight - below.offsetHeight)

    setSeen((was) => (same(was, next) ? was : next))
  }, [viewport, dock])

  return { seen, locate }
}

interface EndProps {
  mode: Follow
  away: boolean
  onClick: () => void
}

// The button back to the end, while the view no longer follows it and sits
// above it. Held still at the end, there is nowhere to go.
const End = ({ mode, away, onClick }: EndProps) => {
  const { t } = useTranslation("conversation")

  if (mode === "following" || !away) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full mb-1.5 flex justify-center">
      <Button
        variant="outline"
        size="xs"
        className="pointer-events-auto rounded-full bg-card/80 shadow-sm backdrop-blur-md motion-reduce:transition-none dark:bg-card/80"
        onClick={onClick}
      >
        <ChevronDown aria-hidden="true" data-icon="inline-start" />
        {t(($) => $["Scroll to end"])}
      </Button>
    </div>
  )
}

interface ScrollProps {
  children: ReactNode
  composer: ReactNode
  previews: ReadonlyArray<Preview>
  asked: number | undefined
}

// How a scroll the app starts moves: at once when motion is reduced.
const motion = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"

const positionOf = (node: HTMLElement) => ({
  top: node.scrollTop,
  height: node.clientHeight,
  content: node.scrollHeight,
})

// Makes the content tall enough to scroll its last question 24px from the
// top, however short its answer. The answer grows into the space, and only an
// answer taller than it moves the end. The space belongs to the content, not
// to a row, so it outlasts any row that changes.
const reserve = (viewport: HTMLElement, content: HTMLElement) => {
  const question = [...content.querySelectorAll("[data-question]")].at(-1)

  if (question === undefined) return

  const top = question.getBoundingClientRect().top - content.getBoundingClientRect().top
  content.style.minHeight = `${top - 24 + viewport.clientHeight}px`
}

// Fits the space to the viewport and the rows again, once a question asked
// here reserved it. It stays until the next question takes it over.
const refit = (viewport: HTMLElement, content: HTMLElement) => {
  if (content.style.minHeight !== "") reserve(viewport, content)
}

// The composer is docked at the end of the content and sticks to the bottom
// of the viewport, so rows scroll under it and the last one still ends above
// it, however tall the composer grows. The dock has no background: rows show
// in the gap beneath the composer, never through it. The scroll button
// rides on top of it.
// The rail beside it jumps between the rows marked as questions. `asked`
// changes each time a question is asked here, and is undefined otherwise.
export const Scroll = ({ children, composer, previews, asked }: ScrollProps) => {
  const { t } = useTranslation("conversation")
  const label = t(($) => $["Conversation"])

  const viewport = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const follow = useRef<Follow>("following")
  const previous = useRef(0)
  // The end the view last scrolled to. A smooth scroll on its way there is
  // left to finish.
  const bottom = useRef(0)
  const [mode, setMode] = useState<Follow>("following")
  // Whether the view sits above the end. Holding still at the end, as when
  // the reader opens a fold, leaves nothing to scroll to.
  const [away, setAway] = useState(false)
  const { seen, locate } = useSeen(viewport, dock)

  const change = useCallback((next: Follow) => {
    follow.current = next
    setMode(next)
  }, [])

  const hold = useCallback(() => change("stopped"), [change])

  // Puts a question 24px from the top and holds it there, as scrolling up does.
  const jump = (index: number) => {
    const node = viewport.current
    const question = node?.querySelectorAll("[data-question]")[index]

    if (node === null || question === undefined) return

    change("stopped")
    node.scrollTo({
      top:
        node.scrollTop +
        question.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        24,
      behavior: motion(),
    })
  }

  const end = useCallback((behavior: ScrollBehavior) => {
    const node = viewport.current

    if (node === null) return
    node.scrollTo({ top: node.scrollHeight, behavior })
    bottom.current = node.scrollHeight - node.clientHeight
    previous.current = node.scrollTop
  }, [])

  useLayoutEffect(() => {
    const node = viewport.current
    const rows = content.current

    if (node === null || rows === null) return undefined

    const followEnd = () => {
      refit(node, rows)
      locate()

      const following = follow.current === "following"

      if (following && node.scrollHeight - node.clientHeight !== bottom.current) end("instant")

      // With nothing to scroll, there is no end to return to.
      if (!following && node.scrollHeight <= node.clientHeight) change("following")

      setAway(!atEnd(positionOf(node)))
    }

    const observer = new ResizeObserver(followEnd)
    observer.observe(node)
    observer.observe(rows)
    followEnd()

    return () => observer.disconnect()
  }, [change, end, locate])

  useLayoutEffect(() => {
    const node = viewport.current
    const rows = content.current

    if (asked === undefined || node === null || rows === null) return

    // The button to scroll to the end goes once the view moves there.
    follow.current = "following"
    reserve(node, rows)
    end(motion())
  }, [asked, end])

  const track = (event: UIEvent<HTMLElement>) => {
    const node = event.currentTarget
    const position = { ...positionOf(node), previous: previous.current }

    change(followScroll(follow.current, position))
    setAway(!atEnd(position))
    previous.current = node.scrollTop
    locate()
  }

  // Back to the end, following it again.
  const resume = () => {
    change("following")
    end(motion())
    viewport.current?.focus({ preventScroll: true })
  }

  return (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      <Rail previews={previews} seen={seen} jump={jump} />
      <section
        ref={viewport}
        aria-label={label}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard readers must be able to focus and scroll the viewport
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
        onScroll={track}
        onWheel={(event) => {
          if (event.deltaY < 0 && event.currentTarget.scrollTop > 0) change("stopped")
        }}
      >
        <div ref={content} className="flex min-h-full flex-col">
          {/* Its own stacking context: nothing a row raises can cover the composer. */}
          <div className="isolate pt-6 pb-8">
            <Hold value={hold}>{children}</Hold>
          </div>
          <div ref={dock} className="sticky bottom-0 z-10 mt-auto">
            <End mode={mode} away={away} onClick={resume} />
            {composer}
          </div>
        </div>
      </section>
    </div>
  )
}
