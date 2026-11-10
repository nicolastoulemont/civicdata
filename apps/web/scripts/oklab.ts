// sRGB colours as hex, OKLab and OKLCH, and their WCAG contrast, for the
// flags and colors scripts. Formulas from https://bottosson.github.io/posts/oklab/.

export type Rgb = readonly [number, number, number]

export type Lab = readonly [number, number, number]

const linear = (channel: number) => {
  const value = channel / 255

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

const encoded = (value: number) =>
  Math.round(
    255 *
      (value <= 0.0031308
        ? 12.92 * value
        : 1.055 * Math.min(1, Math.max(0, value)) ** (1 / 2.4) - 0.055),
  )

export const parse = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

export const hex = (rgb: Rgb) =>
  `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`

export const lab = ([red, green, blue]: Rgb): Lab => {
  const r = linear(red)
  const g = linear(green)
  const b = linear(blue)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

// The sRGB colour of an OKLCH point, or undefined outside the sRGB gamut.
export const fromLch = (lightness: number, chroma: number, hue: number): Rgb | undefined => {
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return [red, green, blue].every((value) => value >= -1e-4 && value <= 1 + 1e-4)
    ? [encoded(red), encoded(green), encoded(blue)]
    : undefined
}

export const chroma = ([, a, b]: Lab) => Math.hypot(a, b)

export const hue = ([, a, b]: Lab) => Math.atan2(b, a)

export const distance = (left: Lab, right: Lab) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])

// WCAG relative luminance and contrast ratio.
const luminance = ([red, green, blue]: Rgb) =>
  0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)

export const contrast = (left: Rgb, right: Rgb) => {
  const [one, other] = [luminance(left), luminance(right)]

  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05)
}

// A neutral OKLCH lightness as sRGB, e.g. the theme's card colour.
export const gray = (lightness: number): Rgb => {
  const channel = encoded(lightness ** 3)

  return [channel, channel, channel]
}
