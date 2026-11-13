import { Publisher } from "@repo/domain"

import { type Dataset, Records } from "../Politics.schemas.ts"

// Every dataset a build stores and every answer reads.
export const datasets: ReadonlyArray<Dataset> = Records.literals.flatMap((records) =>
  Publisher.literals.map((publisher) => ({ records, publisher })),
)
