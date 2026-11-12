import type { BackendModule } from "i18next"

import common from "./locales/en-US/common.json"
import conversation from "./locales/en-US/conversation.json"
import explore from "./locales/en-US/explore.json"
import home from "./locales/en-US/home.json"
import settings from "./locales/en-US/settings.json"

// English ships in the page: the server renders it, the browser hydrates it,
// and a message another locale lacks falls back to it.
export const english = { common, settings, home, conversation, explore }

// Every other catalog is a chunk of its own, fetched once a reader's locale
// needs it.
const catalogs = import.meta.glob<Record<string, string>>(
  ["./locales/*/*.json", "!./locales/en-US/*.json"],
  { import: "default" },
)

export const backend: BackendModule = {
  type: "backend",
  callbackApi: true,
  init: () => undefined,
  read: (locale, namespace, done) => {
    const load = catalogs[`./locales/${locale}/${namespace}.json`]

    if (load === undefined) {
      done(new Error(`No ${namespace} messages in ${locale}`), false)

      return
    }

    void load().then(
      (messages) => done(null, messages),
      () => done(new Error(`The ${namespace} messages in ${locale} did not load`), false),
    )
  },
}
