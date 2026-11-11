import { DateTime, Duration } from "effect"
import type { TFunction } from "i18next"

interface AgoOptions {
  now: DateTime.DateTime
  t: TFunction<"home">
}

// How long ago `then` was, in the sidebar's short form: "now", "5m", "3h",
// "12d". Conversations are deleted after 30 days, so days are the largest unit.
export const ago = (then: DateTime.DateTime, { now, t }: AgoOptions) => {
  const minutes = Math.floor(Duration.toMinutes(DateTime.distance(then, now)))

  if (minutes < 1) return t(($) => $.now)

  if (minutes < 60) return t(($) => $.minute, { count: minutes })

  if (minutes < 60 * 24) return t(($) => $.hour, { count: Math.floor(minutes / 60) })

  return t(($) => $.day, { count: Math.floor(minutes / (60 * 24)) })
}
