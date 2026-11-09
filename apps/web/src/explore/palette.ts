/** A categorical slot or a theme-mixed gray. */
export type Slot = 1 | 2 | 3 | 4 | 5 | 6 | "other" | "faint"

export const fill = (slot: Slot) => `var(--chart-${slot})`

const slots = [1, 2, 3, 4, 5, 6] as const

/** Position assigns identity; countries past six keep their names in gray. */
export const slot = (index: number): Slot => slots[index] ?? "other"

/** The five rank bands, from faint blue to solid blue. */
export const blend = (shade: number) =>
  `color-mix(in oklab, ${fill(1)} ${15 + shade * 21.25}%, ${fill("faint")})`
