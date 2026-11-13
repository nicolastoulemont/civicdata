import type { CatalogEntry } from "@repo/domain"

// The model a deployment that names none in OPENAI_MODEL answers with. Here,
// not in OpenAi.ts, so modules that name it load without @effect/ai-openai.
export const defaultModel = "gpt-6-luna"

// A request about catalog entries: the instructions, then each entry's code,
// name and definition cut to 400 characters, as JSON.
export const about = (instructions: string, entries: ReadonlyArray<CatalogEntry>) =>
  [
    { role: "system", content: instructions },
    {
      role: "user",
      content: JSON.stringify(
        entries.map(({ indicator, name, definition }) => ({
          indicator,
          name,
          definition: definition.slice(0, 400),
        })),
      ),
    },
  ] as const
