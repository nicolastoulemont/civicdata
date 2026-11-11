import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { Lane } from "@/conversation/Lane"
import { QuestionForm } from "@/conversation/QuestionForm"
import { Toggle } from "@/history/Toggle"
import { Mark } from "@/Mark"

// The composer in the middle of the page, in the lane a conversation uses, with
// what happens to the questions asked under it.
const Home = () => {
  const { t } = useTranslation("home")
  const navigate = useNavigate()

  return (
    <main className="flex min-h-svh flex-col justify-center py-6">
      <Toggle className="absolute top-3 left-3" />
      <Lane>
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <h1 className="flex items-center gap-2.5 text-3xl font-semibold tracking-tighter">
            <Mark className="size-8" />
            openfacts
          </h1>
          <p className="text-sm text-muted-foreground">{t(($) => $.intro)}</p>
        </div>
        <QuestionForm
          label={t(($) => $.question)}
          placeholder={t(($) => $.placeholder)}
          draft="home"
          onAsk={(question) =>
            void navigate({
              to: "/c/$id",
              params: { id: crypto.randomUUID() },
              state: { question },
              viewTransition: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            })
          }
        />
        <p className="mt-3 text-center text-xs text-muted-foreground">{t(($) => $.privacy)}</p>
      </Lane>
    </main>
  )
}

export const Route = createFileRoute("/_chat/")({ component: Home })
