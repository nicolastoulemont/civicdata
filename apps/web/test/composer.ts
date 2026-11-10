import { within } from "@testing-library/react"

// A composer's first line, where a click puts the caret. user-event types into
// the composer itself after its lines, which would start a new one.
export const line = (composer: HTMLElement) =>
  within(composer).getAllByRole("paragraph").at(0) ?? composer

// What a composer holds, a paragraph per line.
export const typed = (composer: HTMLElement) =>
  within(composer)
    .queryAllByRole("paragraph")
    .map((paragraph) => paragraph.textContent)
    .join("\n")
