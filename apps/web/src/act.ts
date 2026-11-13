import type { Action } from "@repo/domain"
import { createContext } from "react"

// Tells the conversation what the person did with a chart in one of its
// answers: downloaded its data or copied its link. Outside a conversation it
// does nothing.
export const Act = createContext<(action: Action) => void>(() => {})
