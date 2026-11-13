import { national } from "./data/sheets.gen.ts"

// Font generation needs every inset label without exposing the map registry.
export const labels = async () => {
  const sheets = await Promise.all(Object.values(national).map((load) => load()))

  return sheets.flatMap((sheet) => sheet.insets.map((inset) => inset.name))
}
