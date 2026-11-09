import { Option, Schema } from "effect"
import { useSyncExternalStore } from "react"

// How the app looks in this browser. System follows the operating system.
export const Mode = Schema.Literals(["system", "light", "dark"])

export type Mode = typeof Mode.Type

const key = "civicdata:appearance"

// Stored as JSON in localStorage. Its format outlives deploys: changing it
// resets every visitor to System.
const Stored = Schema.fromJsonString(Mode)

const decode = Schema.decodeUnknownOption(Stored)
const encode = Schema.encodeSync(Stored)

// The theme a stored value pins <html> to, or none for System: the stylesheet
// follows the operating system while <html> has no data-theme. The root route
// inlines this function's source to run before first paint, before any module
// loads, so it may use nothing from outside its body.
export const pin = (stored: string | null): "light" | "dark" | undefined => {
  try {
    const choice: unknown = JSON.parse(stored ?? "null")

    return choice === "light" || choice === "dark" ? choice : undefined
  } catch {
    return undefined
  }
}

// Browsers that block storage throw on any access, so the script and every
// read and write below are guarded and fall back to System.
export const script = `try{const t=(${pin.toString()})(localStorage.getItem(${JSON.stringify(key)}));if(t)document.documentElement.dataset.theme=t}catch{}`

const load = () => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const read = () => Option.getOrElse(decode(load()), () => "system" as const)

const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

// The server renders System: storage lives in the browser.
export const useMode = () => useSyncExternalStore(subscribe, read, () => "system" as const)

// Keeps `mode` in this browser and applies it at once. Without storage
// the choice cannot be kept, so nothing changes.
export const choose = (mode: Mode) => {
  try {
    localStorage.setItem(key, encode(mode))
  } catch {
    return
  }

  if (mode === "system") document.documentElement.removeAttribute("data-theme")
  else document.documentElement.setAttribute("data-theme", mode)

  for (const listener of listeners) listener()
}
