import {
  AgentUnavailable,
  IndicatorId,
  NoChart,
  Trend,
  View,
  type View as ViewType,
  Year,
} from "@civicdata/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { network } from "../../test/network.ts"
import { Ask } from "./Ask.tsx"

const brazil = Trend.make({
  indicator: IndicatorId.make("SP.DYN.LE00.IN"),
  countries: ["BRA"],
  from: Year.make(2004),
  to: Year.make(2024),
})

// Stands in for the home route, which opens the answer on /explore.
const Home = () => {
  const [opened, setOpened] = useState<ViewType>()

  return opened === undefined ? (
    <Ask onAnswer={setOpened} />
  ) : (
    <p>{`Chart of ${opened.indicator} for ${opened.countries.join(", ")}`}</p>
  )
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Home />
    </QueryClientProvider>,
  )

const answering = (response: Response) => http.post("/api/agent/ask", () => response)

const askQuestion = async () => {
  const user = userEvent.setup()

  await user.type(
    screen.getByRole("textbox", { name: "Ask about a country" }),
    "How has life expectancy changed in Brazil?",
  )
  await user.click(screen.getByRole("button", { name: "Ask" }))
}

describe("Ask", () => {
  it("opens the chart the agent answers with", async () => {
    network.use(answering(HttpResponse.json(Schema.encodeSync(View)(brazil))))
    show()

    await askQuestion()

    expect(await screen.findByText("Chart of SP.DYN.LE00.IN for BRA")).toBeDefined()
  })

  it("explains when no chart answers the question", async () => {
    network.use(
      answering(HttpResponse.json(Schema.encodeSync(NoChart)(new NoChart()), { status: 422 })),
    )
    show()

    await askQuestion()

    expect(await screen.findByText("No chart answers that question")).toBeDefined()
  })

  it("explains when the assistant is not available", async () => {
    network.use(
      answering(
        HttpResponse.json(Schema.encodeSync(AgentUnavailable)(new AgentUnavailable()), {
          status: 503,
        }),
      ),
    )
    show()

    await askQuestion()

    expect(await screen.findByText("The assistant is not available")).toBeDefined()
  })
})
