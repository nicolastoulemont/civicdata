import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ExternalLink } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SidebarTrigger } from "@/components/ui/sidebar"
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

const Home = () => {
  const navigate = useNavigate()

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <SidebarTrigger className="absolute top-3 left-3" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>civicdata</h1>
          </CardTitle>
          <CardDescription>
            Ask about the state of a country and get a sourced chart, or open an example.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <QuestionForm
            label="Ask about a country"
            placeholder="How has life expectancy changed in Brazil?"
            onAsk={(question) =>
              void navigate({
                to: "/c/$id",
                params: { id: crypto.randomUUID() },
                state: { question },
              })
            }
          />
          <ul className="flex flex-col gap-2">
            {examples.map((example) => (
              <li key={example.title}>
                <Link
                  className={buttonVariants({
                    variant: "link",
                    className: "h-auto px-0 text-left whitespace-normal",
                  })}
                  to="/explore"
                  search={example.search}
                >
                  {example.title}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          {/* Links stay <a> elements styled as buttons; Base UI's Button forces button semantics. */}
          <a
            className={buttonVariants({ variant: "outline" })}
            href="https://github.com/nicolastoulemont/civicdata"
          >
            View the source
            <ExternalLink data-icon="inline-end" aria-hidden />
          </a>
        </CardFooter>
      </Card>
    </main>
  )
}

export const Route = createFileRoute("/_chat/")({ component: Home })
