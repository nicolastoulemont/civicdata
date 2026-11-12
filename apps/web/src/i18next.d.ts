// oxlint-disable-next-line import/no-unassigned-import -- augments i18next's translation contract
import "i18next"
import type { english } from "./messages.ts"

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common"
    resources: typeof english
    enableSelector: true
    keySeparator: false
    nsSeparator: false
    strictKeyChecks: true
  }
}
