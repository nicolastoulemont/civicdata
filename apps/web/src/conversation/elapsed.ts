import { Duration } from "effect"

const pad = (value: number) => String(value).padStart(2, "0")

// How long the agent worked, to the second: "4s", "1m 05s", "1h 02m".
export const elapsed = (duration: Duration.Duration) => {
  const seconds = Math.max(0, Math.floor(Duration.toSeconds(duration)))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (minutes === 0) return `${seconds}s`

  if (hours === 0) return `${minutes}m ${pad(seconds % 60)}s`

  return `${hours}h ${pad(minutes % 60)}m`
}
