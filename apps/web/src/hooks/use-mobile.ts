import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

  mql.addEventListener("change", onChange)

  return () => mql.removeEventListener("change", onChange)
}

// Rewritten from shadcn's effect-and-state version to read the width during
// render. The server renders the desktop layout.
export const useIsMobile = () =>
  useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
