import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"
import type * as React from "react"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  labels,
  trackClassName,
  rangeClassName,
  thumbClassName,
  children,
  ...props
}: SliderPrimitive.Root.Props & {
  // Each thumb's accessible name, e.g. "First year" and "Last year".
  labels?: ReadonlyArray<string>
  trackClassName?: string
  rangeClassName?: string
  thumbClassName?: string
  // Drawn inside the track, under the range, e.g. a chart the range selects from.
  children?: React.ReactNode
}) {
  const thumbs = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1",
            trackClassName,
          )}
        >
          {children}
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              "bg-primary select-none data-horizontal:h-full data-vertical:w-full",
              rangeClassName,
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbs.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            index={index}
            aria-label={labels?.[index]}
            className={cn(
              "relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50",
              thumbClassName,
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
