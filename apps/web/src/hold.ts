import { createContext } from "react"

// Holds a scrolling view where it is, as scrolling up does: a row the reader
// opens or changes stays under their pointer instead of following the end.
// Outside a conversation it does nothing.
export const Hold = createContext<() => void>(() => {})
