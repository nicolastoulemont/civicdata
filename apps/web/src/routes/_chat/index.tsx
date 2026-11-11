import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { buttonVariants } from "@/components/ui/button"
import { Lane } from "@/conversation/Lane"
import { QuestionForm } from "@/conversation/QuestionForm"
import type { Search } from "@/explore/search"
import { Toggle } from "@/history/Toggle"

const examples: ReadonlyArray<{ key: "population" | "gdp" | "life"; search: Search }> = [
  {
    key: "population",
    search: {
      chart: "trend",
      indicator: "SP.POP.TOTL",
      countries: "DEU,FRA,ITA,ESP",
      from: 2000,
      to: 2024,
    },
  },
  {
    key: "gdp",
    search: {
      chart: "ranking",
      indicator: "NY.GDP.PCAP.CD",
      countries: "USA,JPN,DEU,GBR,FRA,ITA,CAN",
      year: 2023,
    },
  },
  {
    key: "life",
    search: {
      chart: "trend",
      indicator: "SP.DYN.LE00.IN",
      countries: "NOR,SWE,DNK,FIN,ISL",
      from: 1990,
      to: 2023,
    },
  },
]

// The composer in the middle of the page, in the lane a conversation uses, with
// the examples under it, then what happens to the questions asked.
const Home = () => {
  const { t } = useTranslation("home")
  const navigate = useNavigate()

  return (
    <main className="flex min-h-svh flex-col justify-center py-6">
      <Toggle className="absolute top-3 left-3" />
      <Lane>
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-medium tracking-tight">civicdata</h1>
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
        <ul className="mt-2 flex flex-wrap gap-1">
          {examples.map((example) => (
            <li key={example.key}>
              <Link
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                  className: "h-auto min-h-7 text-left whitespace-normal text-muted-foreground",
                })}
                to="/explore"
                search={example.search}
              >
                {t(($) => $[example.key])}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-xs text-muted-foreground">{t(($) => $.privacy)}</p>
      </Lane>
    </main>
  )
}

export const Route = createFileRoute("/_chat/")({ component: Home })
