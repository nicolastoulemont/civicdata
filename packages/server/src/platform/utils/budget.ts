import { Duration, Schema } from "effect"

import { gaps } from "../constants/gaps.ts"
import { Host, type Key } from "../Pace.schemas.ts"
import type { Budget } from "../Pace.types.ts"

const minute = 60_000
const hour = 60 * minute

// Workers send from one IP shared with every other Worker (NTO-89), so these
// budgets leave room for traffic that is not ours.
const budgets = {
  // No request quota is documented for public xMart. This is our budget, not a WHO limit.
  WHO: { windows: [{ count: 10, period: minute }], cooldown: minute },
  ILOSTAT: { windows: [{ count: 10, period: minute }], cooldown: minute },
  // Melodi documents 30 anonymous requests/minute. Leave headroom.
  INSEE: { windows: [{ count: 25, period: minute }], cooldown: minute },
  // OECD refused the Workers' IP after about 20 requests in a minute, and for
  // five minutes after about 60 in ten. It documents 60 an hour.
  OECD: {
    windows: [
      { count: 15, period: minute },
      { count: 50, period: hour },
    ],
    cooldown: 5 * minute,
  },
  // Eurostat answered 540 requests in a minute without refusing one.
  Eurostat: { windows: [{ count: 60, period: minute }], cooldown: minute },
  // The World Bank documents no limit.
  "World Bank": { windows: [{ count: 120, period: minute }], cooldown: minute },
} satisfies Record<string, Budget>

const isHost = Schema.is(Host)

// New API adapters must choose and register their measured budget here.
// Unregistered publishers are paced conservatively until then. A host gets
// one request per gap, and a minute's rest after it refuses one.
export const budget = (key: Key): Budget => {
  if (isHost(key))
    return {
      windows: [{ count: 1, period: Duration.toMillis(gaps.hosts[key] ?? gaps.gap) }],
      cooldown: minute,
    }

  return (
    Object.entries(budgets).find(([name]) => name === key)?.[1] ?? {
      windows: [{ count: 1, period: minute }],
      cooldown: minute,
    }
  )
}
