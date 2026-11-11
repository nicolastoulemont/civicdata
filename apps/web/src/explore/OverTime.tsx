import { inYear, type Ranked, type Related, type Span, Year } from "@openfacts/domain"
import { cn } from "cn"
import { Pause, Play } from "lucide-react"
import { type ReactNode, useEffect, useEffectEvent, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

import { useFormat } from "./useFormat.ts"

// A slider reports one value per thumb; this one has one.
const yearOf = (value: number | ReadonlyArray<number>) => Year.make([value].flat()[0] ?? 0)

// A label at `place`, from 0 to 100 along the slider, stays inside its width.
const align = (place: number) =>
  place < 15 ? "" : place > 85 ? "-translate-x-full" : "-translate-x-1/2"

// The year a chart over time shows, and how a reader moves it.
export interface Moving {
  // The year saved with the View.
  readonly year: Year
  // The year the agent wrote about, in a conversation.
  readonly agent: Year | undefined
  // Saves a year: when the reader lets go of the slider, or pauses.
  readonly onYear: (year: Year) => void
}

interface PlaybackProps {
  playing: boolean
  onClick: () => void
}

const Playback = ({ playing, onClick }: PlaybackProps) => {
  const { t } = useTranslation("explore")

  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      {playing ? t(($) => $["Pause"]) : t(($) => $["Play"])}
    </Button>
  )
}

interface OverTimeProps extends Moving {
  // Every year of the span.
  resolved: Ranked | Related
  span: Span
  // Draws the year shown, knowing whether play runs.
  children: (shown: Year, playing: boolean) => ReactNode
}

// How long play shows each year.
const step = 1000

// A ranking, map or relation over time: the chart of the year shown, the
// countries without a value that year, and a slider of the span's years with the
// agent's year marked. Moving the slider redraws the chart at once; only
// letting go saves the year, so the link or the conversation keeps it.
// Play shows the next year each second and saves nothing until it pauses:
// when the reader presses Pause or moves the slider, or at the last year.
export const OverTime = ({ resolved, span, year, agent, onYear, children }: OverTimeProps) => {
  const { countryName } = useFormat()

  const { t } = useTranslation("explore")

  const { from, to } = span
  const [live, setLive] = useState(year)
  const [saved, setSaved] = useState(year)
  const [playing, setPlaying] = useState(false)

  // A year saved elsewhere, e.g. the agent's chart restored, moves the slider.
  if (saved !== year) {
    setSaved(year)
    setLive(year)
  }

  // Data for another span may still be on screen while the View's loads.
  const shown = inYear(resolved, Year.make(Math.min(Math.max(live, from), to)))
  const at = (each: number) => (to === from ? 0 : ((each - from) / (to - from)) * 100)
  const marked = agent !== undefined && agent >= from && agent <= to ? agent : undefined

  const save = (next: Year) => {
    if (next !== year) onYear(next)
  }

  // Each second shows the next year; the last pauses play and saves it.
  const advance = useEffectEvent(() => {
    const next = Year.make(Math.min(shown.view.year + 1, to))

    setLive(next)

    if (next < to) return

    setPlaying(false)
    save(next)
  })

  useEffect(() => {
    if (!playing) return undefined

    const timer = setInterval(advance, step)

    return () => clearInterval(timer)
  }, [playing])

  const labels = {
    missing: t(($) => $["No data in {{value}} for {{value2}}."], {
      value: shown.view.year,
      value2: shown.missing.map(countryName).join(", "),
    }),
    year: t(($) => $["Year"]),
    agent: t(($) => $["Agent's year {{value}}"], { value: marked }),
  }

  return (
    <div className="flex flex-col gap-4">
      {children(shown.view.year, playing)}
      {shown.missing.length > 0 ? (
        <p className="text-sm text-muted-foreground">{labels.missing}</p>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Playback
            playing={playing}
            onClick={() => {
              if (playing) {
                setPlaying(false)
                save(shown.view.year)

                return
              }

              // Played to its end, it starts again from the first year.
              if (shown.view.year >= to) setLive(from)

              setPlaying(true)
            }}
          />
          <output aria-live="polite" className="text-sm font-medium tabular-nums">
            {shown.view.year}
          </output>
        </div>
        <Slider
          value={[shown.view.year]}
          min={from}
          max={to}
          step={1}
          thumbAlignment="center"
          labels={[labels.year]}
          onValueChange={(value) => {
            setPlaying(false)
            setLive(yearOf(value))
          }}
          onValueCommitted={(value) => save(yearOf(value))}
          trackClassName="data-horizontal:h-1.5"
        >
          {marked === undefined ? null : (
            <span
              aria-hidden
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground"
              style={{ left: `${at(marked)}%` }}
            />
          )}
        </Slider>
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{from}</span>
          <span>{to}</span>
        </div>
        {marked === undefined ? null : (
          <div className="relative h-4 text-xs">
            <span
              className={cn("absolute whitespace-nowrap", align(at(marked)))}
              style={{ left: `${at(marked)}%` }}
            >
              {labels.agent}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
