// oxlint-disable-next-line import/no-unassigned-import -- Vite injects the app's theme and Tailwind styles into every story.
import "../src/styles.css"
import { ResolvedView } from "@openfacts/domain"
import type { Decorator, Preview } from "@storybook/react-vite"
import { Schema } from "effect"
import { type ReactNode, useLayoutEffect } from "react"
import { I18nextProvider } from "react-i18next"

import { Card, CardContent, CardFooter } from "../src/components/ui/card.tsx"
import { attribution } from "../src/explore/format.ts"
import { createI18n } from "../src/locale.tsx"

const isResolved = Schema.is(ResolvedView)

interface ThemedProps {
  theme: string
  children: ReactNode
}

// The theme the toolbar picks, set on <html> as the page's own switch does.
const Themed = ({ theme, children }: ThemedProps) => {
  useLayoutEffect(() => {
    document.documentElement.dataset["theme"] = theme
  }, [theme])

  return children
}

// A chart sits in a card with its source credit under it, as on the page:
// the World Bank, Eurostat and the OECD require the credit on every chart.
const carded: Decorator = (Story, { args, globals }) => {
  const resolved = args["resolved"]

  return (
    <Themed theme={String(globals["theme"])}>
      <Card className="mx-auto max-w-3xl">
        <CardContent>
          <Story />
        </CardContent>
        {isResolved(resolved) ? (
          <CardFooter className="text-sm text-muted-foreground">
            <p>{attribution(resolved)}</p>
          </CardFooter>
        ) : null}
      </Card>
    </Themed>
  )
}

const instance = createI18n()

const preview: Preview = {
  decorators: [
    (Story) => (
      <I18nextProvider i18n={instance}>
        <Story />
      </I18nextProvider>
    ),
    carded,
  ],
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  parameters: { layout: "padded" },
}

export default preview
