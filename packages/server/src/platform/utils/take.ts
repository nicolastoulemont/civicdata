import { type Key, type Ledger, Slot } from "../Pace.schemas.ts"
import { budget } from "./budget.ts"

// Grants the earliest time at or after `now` that keeps every window of the
// limiter's budget, if it is no more than `patience` away. Grants never go
// back in time, so concurrent callers queue behind one another.
export const take = (
  key: Key,
  { ledger, now, patience }: { ledger: Ledger; now: number; patience: number },
): { readonly slot: Slot; readonly ledger: Ledger } => {
  const { windows } = budget(key)
  const longest = Math.max(...windows.map((window) => window.period))
  const sent = ledger.sent.filter((at) => at > now - longest)

  const at = Math.max(
    now,
    ledger.blockedUntil,
    sent.at(-1) ?? 0,
    ...windows.map(({ count, period }) => (sent[sent.length - count] ?? -Infinity) + period),
  )

  const { blockedUntil } = ledger

  return at - now > patience
    ? { slot: Slot.cases.Full.make({ wait: at - now }), ledger: { sent, blockedUntil } }
    : {
        slot: Slot.cases.Granted.make({ wait: at - now }),
        ledger: { sent: [...sent, at], blockedUntil },
      }
}
