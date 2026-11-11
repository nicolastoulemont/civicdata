import { Effect } from "effect"

import { fill } from "./fill.ts"

await Effect.runPromise(fill("FAOSTAT"))
