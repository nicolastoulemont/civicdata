import { Duration } from "effect"
import type { TFunction } from "i18next"

const pad = (value: number) => String(value).padStart(2, "0")

// How long the agent worked, to the second: "4s", "1m 05s", "1h 02m".
export const elapsed = (duration: Duration.Duration, t: TFunction<"conversation">) => {
  const seconds = Math.max(0, Math.floor(Duration.toSeconds(duration)))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (minutes === 0) return t(($) => $["{{seconds}}s"], { seconds: seconds })

  if (hours === 0)
    return t(($) => $["{{minutes}}m {{value2}}s"], { minutes: minutes, value2: pad(seconds % 60) })

  return t(($) => $["{{hours}}h {{value2}}m"], { hours: hours, value2: pad(minutes % 60) })
}
