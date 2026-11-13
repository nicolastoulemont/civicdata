import { Schema } from "effect"

import { Annotation } from "./annotation.ts"
import { Content, Paper } from "./archive.ts"

export const Document = Paper.mapFields((fields) => ({ ...fields, content: Content.cases.Text }))

export interface Document extends Schema.Schema.Type<typeof Document> {}

export const Entry = Schema.Struct({ paper: Document, annotation: Annotation })

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
