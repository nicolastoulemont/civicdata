import { Year } from "@civicdata/domain"
import { Machine } from "@civicdata/machine"
import { Data } from "effect"

export interface Years {
  readonly from: Year
  readonly to: Year
}

// Where a press on the year window started: the pointer, the width it moves
// over, the years under the window and the history's first and last year.
interface Press {
  readonly x: number
  readonly width: number
  readonly start: Years
  readonly first: number
  readonly last: number
}

// A drag over a trend's year window: nothing held, a thumb sliding, the
// window pressed, or the window moving.
export type Drag = Data.TaggedEnum<{
  Still: {}
  Sliding: { readonly years: Years }
  Pressed: Press
  Panning: Press & { readonly moved: Years }
}>

export const Drag = Data.taggedEnum<Drag>()

export type Gesture = Data.TaggedEnum<{
  // A thumb moved, or the slider settled on years.
  Slide: { readonly years: Years }
  Settle: { readonly years: Years }
  // The window was pressed, moved, let go, or the browser took the pointer.
  Press: Press
  Move: { readonly x: number }
  Release: {}
  Cancel: {}
}>

export const Gesture = Data.taggedEnum<Gesture>()

// The years under the window once the pointer is at `x`: it keeps its length
// and moves by whole years, within the history.
const shifted = ({ x, width, start, first, last }: Press, to: number): Years => {
  const shift = width === 0 ? 0 : Math.round(((to - x) / width) * (last - first))
  const length = start.to - start.from
  const from = Math.min(Math.max(start.from + shift, first), last - length)

  return { from: Year.make(from), to: Year.make(from + length) }
}

// Hands back the years a drag ends on. A press let go without moving, or a
// drag the browser cancels, changes nothing.
export const drag = Machine.make<Drag, Gesture, Years>()({
  initial: () => Drag.Still(),
  on: {
    Still: {
      Slide: (_, { years }) => Drag.Sliding({ years }),
      Settle: (still, { years }) => Machine.emit(still, years),
      Press: (_, press) => Drag.Pressed(press),
      ignore: ["Move", "Release", "Cancel"],
    },
    Sliding: {
      Slide: (_, { years }) => Drag.Sliding({ years }),
      Settle: (_, { years }) => Machine.emit(Drag.Still(), years),
      Cancel: () => Drag.Still(),
      ignore: ["Press", "Move", "Release"],
    },
    Pressed: {
      Move: (pressed, { x }) => {
        const moved = shifted(pressed, x)

        return moved.from === pressed.start.from ? pressed : Drag.Panning({ ...pressed, moved })
      },
      Release: () => Drag.Still(),
      Cancel: () => Drag.Still(),
      ignore: ["Slide", "Settle", "Press"],
    },
    Panning: {
      Move: (panning, { x }) => Drag.Panning({ ...panning, moved: shifted(panning, x) }),
      Release: ({ moved }) => Machine.emit(Drag.Still(), moved),
      Cancel: () => Drag.Still(),
      ignore: ["Slide", "Settle", "Press"],
    },
  },
})

// The years a drag holds on screen before they are picked, if any.
export const held = (state: Drag): Years | undefined =>
  Drag.$match(state, {
    Still: () => undefined,
    Sliding: ({ years }) => years,
    Pressed: () => undefined,
    Panning: ({ moved }) => moved,
  })
