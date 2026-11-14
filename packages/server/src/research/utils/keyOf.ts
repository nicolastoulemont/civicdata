import type { Passage } from "../archive.schemas.ts"

export const keyOf = ({ page, part }: Pick<typeof Passage.Type, "page" | "part">) =>
  `${page}:${part}`
