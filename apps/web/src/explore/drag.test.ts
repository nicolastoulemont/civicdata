import { Year } from "@openfacts/domain"
import { Machine } from "@openfacts/machine"
import { Option } from "effect"
import { describe, expect, it } from "vitest"

import { Drag, drag, Gesture, held, type Years } from "./drag.ts"

const years = (from: number, to: number): Years => ({ from: Year.make(from), to: Year.make(to) })

// A press on a window over 2000–2010, in a history from 1990 to 2020 drawn
// 300 pixels wide: ten pixels a year.
const press = Gesture.Press({
  x: 100,
  width: 300,
  start: years(2000, 2010),
  first: 1990,
  last: 2020,
})

// Runs gestures from a still window, keeping the last state and every output.
const run = (...gestures: ReadonlyArray<Gesture>) =>
  gestures.reduce<{ state: Drag; picked: ReadonlyArray<Years> }>(
    ({ state, picked }, gesture) => {
      const next = Machine.next(drag, state, gesture)

      return { state: next.state, picked: [...picked, ...Option.toArray(next.output)] }
    },
    { state: drag.initial(), picked: [] },
  )

describe("drag", () => {
  it("moves the window by whole years and picks its years when let go", () => {
    const moved = run(press, Gesture.Move({ x: 130 }))

    expect(held(moved.state)).toEqual(years(2003, 2013))
    expect(run(press, Gesture.Move({ x: 130 }), Gesture.Release()).picked).toEqual([
      years(2003, 2013),
    ])
  })

  it("keeps the window inside the history", () => {
    expect(held(run(press, Gesture.Move({ x: 900 })).state)).toEqual(years(2010, 2020))
  })

  it("picks nothing when the window is pressed and let go without moving", () => {
    const clicked = run(press, Gesture.Release())

    expect(clicked).toEqual({ state: Drag.Still(), picked: [] })
  })

  it("drops a drag the browser cancels, so the trend's own years show again", () => {
    const cancelled = run(press, Gesture.Move({ x: 130 }), Gesture.Cancel())

    expect(cancelled).toEqual({ state: Drag.Still(), picked: [] })
    expect(held(cancelled.state)).toBeUndefined()
  })

  it("follows a thumb and picks the years the slider settles on", () => {
    const sliding = run(Gesture.Slide({ years: years(1999, 2010) }))

    expect(held(sliding.state)).toEqual(years(1999, 2010))
    expect(
      run(
        Gesture.Slide({ years: years(1999, 2010) }),
        Gesture.Settle({ years: years(1999, 2010) }),
      ),
    ).toEqual({ state: Drag.Still(), picked: [years(1999, 2010)] })
  })

  it("ignores the slider while the window moves", () => {
    const moving = run(press, Gesture.Move({ x: 130 }), Gesture.Slide({ years: years(1995, 2010) }))

    expect(held(moving.state)).toEqual(years(2003, 2013))
  })
})
