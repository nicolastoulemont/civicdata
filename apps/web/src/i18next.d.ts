// oxlint-disable-next-line import/no-unassigned-import -- augments i18next's translation contract
import "i18next"
import type { resources } from "./messages.ts"

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common"
    resources: (typeof resources)["en-US"]
    enableSelector: true
    keySeparator: false
    nsSeparator: false
    strictKeyChecks: true
  }
}
