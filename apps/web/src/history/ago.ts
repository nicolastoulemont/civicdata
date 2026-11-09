import { DateTime, Duration } from "effect"

// How long ago `then` was, in the sidebar's short form: "now", "5m", "3h",
// "12d". Conversations are deleted after 30 days, so days are the largest unit.
export const ago = (then: DateTime.DateTime, now: DateTime.DateTime) => {
  const minutes = Math.floor(Duration.toMinutes(DateTime.distance(then, now)))

  if (minutes < 1) return "now"

  if (minutes < 60) return `${minutes}m`

  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`

  return `${Math.floor(minutes / (60 * 24))}d`
}
