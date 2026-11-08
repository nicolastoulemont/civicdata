import { createFileRoute } from "@tanstack/react-router"
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

const Home = () => (
  <main className="flex min-h-svh items-center justify-center p-6">
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1>civicdata</h1>
        </CardTitle>
        <CardDescription>Ask about the state of a country and get a sourced chart.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        Every number comes from the World Bank, Eurostat or the OECD, with a link to its source.
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

export const Route = createFileRoute("/")({ component: Home })
