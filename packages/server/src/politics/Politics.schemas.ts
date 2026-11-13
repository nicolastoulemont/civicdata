import { Publisher } from "@repo/domain"
import { Schema } from "effect"

// The kinds of political records, each in its own table.
export const Records = Schema.Literals(["governments", "elections"])

// One publisher's records of one kind, stored and published together.
export const Dataset = Schema.Struct({ records: Records, publisher: Publisher })

export type Dataset = typeof Dataset.Type
