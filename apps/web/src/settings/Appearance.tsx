import { cn } from "cn"
import { Schema } from "effect"
import { useId } from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

import { choose, Mode, useMode } from "./appearance.ts"

interface PaneProps {
  theme: "light" | "dark"
  className?: string
}

// The app in one theme: the sidebar, a question, an answer with its chart,
// and the composer. data-theme scopes the tokens, so it draws with them.
const Pane = ({ theme, className }: PaneProps) => (
  <span data-theme={theme} className={cn("absolute inset-0 bg-background", className)}>
    <span className="absolute inset-y-0 left-0 w-1/5 border-r bg-sidebar" />
    <span className="absolute top-[10%] left-[3%] h-[6%] w-[14%] rounded-sm bg-sidebar-accent" />
    <span className="absolute top-[22%] left-[3%] h-[4%] w-[12%] rounded-sm bg-muted-foreground/30" />
    <span className="absolute top-[30%] left-[3%] h-[4%] w-[10%] rounded-sm bg-muted-foreground/30" />
    <span className="absolute top-[8%] right-[8%] h-[10%] w-[30%] rounded-md bg-message-surface" />
    <span className="absolute top-[25%] left-[28%] h-[4%] w-[40%] rounded-sm bg-muted-foreground/30" />
    <span className="absolute top-[35%] right-[8%] left-[28%] h-[30%] rounded-md border bg-card">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="size-full" fill="none">
        <polyline
          points="6,30 30,24 54,26 78,14 94,10"
          className="stroke-chart-1"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points="6,34 30,30 54,20 78,22 94,18"
          className="stroke-chart-2"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
    <span className="absolute right-[8%] bottom-[8%] left-[28%] h-[14%] rounded-md border bg-card" />
  </span>
)

interface DrawingProps {
  mode: Mode
}

// System is split: light on the left, dark on the right.
const Drawing = ({ mode }: DrawingProps) => (
  <span aria-hidden className="relative block aspect-4/3 w-full overflow-hidden rounded-md border">
    {mode === "system" ? (
      <>
        <Pane theme="light" className="[clip-path:inset(0_50%_0_0)]" />
        <Pane theme="dark" className="[clip-path:inset(0_0_0_50%)]" />
      </>
    ) : (
      <Pane theme={mode} />
    )}
  </span>
)

const isMode = Schema.is(Mode)

// System, Light or Dark, applied as soon as it is picked.
export const Appearance = () => {
  const { t } = useTranslation("settings")
  const titles = { system: t(($) => $.system), light: t(($) => $.light), dark: t(($) => $.dark) }
  const mode = useMode()
  const id = useId()

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="font-heading text-base font-medium">
          {t(($) => $.appearance)}
        </h2>
        <p className="text-sm text-muted-foreground">{t(($) => $.appearanceDescription)}</p>
      </div>
      <RadioGroup
        aria-labelledby={`${id}-heading`}
        className="grid-cols-3 gap-3"
        value={mode}
        onValueChange={(value) => {
          if (isMode(value)) choose(value)
        }}
      >
        {Mode.literals.map((choice) => (
          <FieldLabel
            key={choice}
            htmlFor={`${id}-${choice}`}
            className="has-data-checked:ring-2 has-data-checked:ring-primary"
          >
            <Field>
              <Drawing mode={choice} />
              <span className="flex items-center justify-center gap-2">
                <RadioGroupItem value={choice} id={`${id}-${choice}`} />
                <FieldTitle>{titles[choice]}</FieldTitle>
              </span>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    </section>
  )
}
