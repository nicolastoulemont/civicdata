import type { StorybookConfig } from "@storybook/react-vite"
import type { PluginOption } from "vite"

// TanStack Start's plugins take over the dev server to render routes and
// server functions. A story renders one component, so they are left out and
// the rest of vite.config.ts (Tailwind, React, the `@/` alias) applies.
const routed = (plugin: PluginOption) =>
  plugin !== null && plugin !== false && "name" in plugin && plugin.name.startsWith("tanstack")

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({
    ...vite,
    plugins: (vite.plugins ?? []).flat(Infinity).filter((plugin) => !routed(plugin)),
  }),
}

export default config
