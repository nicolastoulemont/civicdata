import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Lane } from "@/conversation/Lane"
import { QuestionForm } from "@/conversation/QuestionForm"
import type { Search } from "@/explore/search"

const examples: ReadonlyArray<{ title: string; search: Search }> = [
  {
    title: "Population of the four largest EU economies since 2000",
    search: {
      chart: "trend",
      indicator: "SP.POP.TOTL",
      countries: "DEU,FRA,ITA,ESP",
      from: 2000,
      to: 2024,
    },
  },
  {
    title: "GDP per person in the G7, 2023",
    search: {
      chart: "ranking",
      indicator: "NY.GDP.PCAP.CD",
      countries: "USA,JPN,DEU,GBR,FRA,ITA,CAN",
      year: 2023,
    },
  },
  {
    title: "Life expectancy in the Nordic countries since 1990",
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
// the examples under it.
const Home = () => {
  const navigate = useNavigate()

  return (
    <main className="flex min-h-svh flex-col justify-center py-6">
      <SidebarTrigger className="absolute top-3 left-3" />
      <Lane>
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-medium tracking-tight">civicdata</h1>
          <p className="text-sm text-muted-foreground">
            Ask about the state of a country and get a sourced chart, or open an example.
          </p>
        </div>
        <QuestionForm
          label="Ask about a country"
          placeholder="How has life expectancy changed in Brazil?"
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
            <li key={example.title}>
              <Link
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                  className: "h-auto min-h-7 text-left whitespace-normal text-muted-foreground",
                })}
                to="/explore"
                search={example.search}
              >
                {example.title}
              </Link>
            </li>
          ))}
        </ul>
      </Lane>
    </main>
  )
}

export const Route = createFileRoute("/_chat/")({ component: Home })
