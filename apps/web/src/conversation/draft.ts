import type { ConversationId } from "@openfacts/domain"

// Which composer a draft is typed in: the home page's, or a conversation's.
export type Draft = "home" | ConversationId

const key = (draft: Draft) => `civicdata:draft:${draft}`

// The question typed in a composer and not yet sent, kept in this browser so a
// reload or a visit to another conversation does not lose it. Storage is
// missing on the server and can be blocked or full in the browser: a failed
// read is an empty draft, and a failed write keeps nothing. Any string is a
// draft: the composer checks a question before it sends it.
export const load = (draft: Draft) => {
  try {
    return localStorage.getItem(key(draft)) ?? ""
  } catch {
    return ""
  }
}

// An empty draft deletes the saved one.
export const save = (draft: Draft, text: string) => {
  try {
    if (text === "") localStorage.removeItem(key(draft))
    else localStorage.setItem(key(draft), text)
  } catch {
    return
  }
}
