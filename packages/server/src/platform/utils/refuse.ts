import type { Key, Ledger } from "../Pace.schemas.ts"
import { budget } from "./budget.ts"

// The source or host refused a request: ask it nothing until its cooldown
// is over.
export const refuse = (key: Key, { ledger, now }: { ledger: Ledger; now: number }): Ledger => ({
  sent: ledger.sent,
  blockedUntil: Math.max(ledger.blockedUntil, now + budget(key).cooldown),
})
