import { builtinEnvironments } from "vitest/runtime"
import type { Environment } from "vitest/runtime"

const happyDom = builtinEnvironments["happy-dom"]

// happy-dom keeps the console it is built with and writes the page's network
// errors to it. Vitest builds the window before it starts capturing each
// test's logs, so those errors skip the capture: they print on every run and
// belong to no test. Hand happy-dom a console that writes through whichever
// console is current, so they land under the test that sent the request.
export default {
  ...happyDom,
  async setup(global, options) {
    const node: Console = global.console
    const isMember = (key: string | symbol): key is keyof Console => key in node

    const current: Console = new Proxy(node, {
      get: (_, key) => {
        const live: Console = global.console === current ? node : global.console

        return isMember(key) ? live[key] : undefined
      },
    })

    global.console = current

    try {
      return await happyDom.setup(global, options)
    } finally {
      global.console = node
    }
  },
} satisfies Environment
