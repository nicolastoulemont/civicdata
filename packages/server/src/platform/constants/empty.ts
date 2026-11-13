import type { Ledger } from "../Pace.schemas.ts"

export const empty: Ledger = { sent: [], blockedUntil: 0 }
