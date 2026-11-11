import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router"
import { Schema, Struct } from "effect"
import { type LucideIcon, Languages, Palette } from "lucide-react"
import { type ComponentType, useState } from "react"
import { useTranslation } from "react-i18next"

import { buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

import { Appearance } from "./Appearance.tsx"
import { Language } from "./Language.tsx"

// A part of Settings, named by ?settings= in the address.
export const Section = Schema.Literals(["appearance", "language"])

type Section = typeof Section.Type

const sections: Record<Section, { Icon: LucideIcon; Panel: ComponentType }> = {
  appearance: { Icon: Palette, Panel: Appearance },
  language: { Icon: Languages, Panel: Language },
}

// Leaves Settings for the page under it: back through history when Settings
// was opened from that page, else to the same address without ?settings=.
const useLeave = () => {
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()

  return () => {
    if (canGoBack) router.history.back()
    else
      void navigate({
        to: ".",
        search: (prev) => Struct.omit(prev, ["settings"]),
        replace: true,
      })
  }
}

interface SettingsProps {
  section: Section
}

// Settings over the page that opened them: the sections on the left, the
// picked one on the right; the whole screen on phones. Escape, the close
// button and the browser's back button close it.
export const Settings = ({ section }: SettingsProps) => {
  const { t } = useTranslation("settings")
  const titles = { appearance: t(($) => $.appearance), language: t(($) => $.language) }
  const [open, setOpen] = useState(true)
  const leave = useLeave()
  const { Panel } = sections[section]

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(opened) => {
        if (!opened) leave()
      }}
    >
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 max-sm:inset-0 max-sm:max-w-none max-sm:translate-0 max-sm:rounded-none sm:h-[min(36rem,calc(100dvh-3rem))] sm:max-w-3xl sm:flex-row">
        <nav
          aria-label={t(($) => $.sections)}
          className="flex shrink-0 flex-col gap-2 border-b bg-sidebar p-2 sm:w-52 sm:border-r sm:border-b-0"
        >
          <DialogTitle className="px-2 pt-1.5 pb-1">{t(($) => $.title)}</DialogTitle>
          <ul className="flex gap-1 sm:flex-col">
            {Section.literals.map((key) => {
              const { Icon } = sections[key]

              return (
                <li key={key}>
                  <Link
                    to="."
                    search={(prev) => ({ ...prev, settings: key })}
                    replace
                    className={buttonVariants({
                      variant: "ghost",
                      className: "w-full justify-start data-[status=active]:bg-sidebar-accent",
                    })}
                  >
                    <Icon aria-hidden />
                    {titles[key]}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Panel />
        </div>
      </DialogContent>
    </Dialog>
  )
}
