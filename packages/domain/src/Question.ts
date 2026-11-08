import { Schema } from "effect"

// What someone asks about countries, e.g. "How has life expectancy changed in
// Brazil?". Capped so one request cannot send the model an essay.
export const Question = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(500))
