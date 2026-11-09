export type Follow = "following" | "stopped"

interface Position {
  top: number
  height: number
  content: number
}

// A small end band tolerates fractional pixels and browser rounding.
export const atEnd = ({ top, height, content }: Position) => content - height - top <= 4

// Growth alone never releases follow. Only a move toward older rows does.
export const followScroll = (mode: Follow, position: Position & { previous: number }): Follow => {
  if (atEnd(position)) return "following"

  if (position.top < position.previous) return "stopped"

  return mode
}
