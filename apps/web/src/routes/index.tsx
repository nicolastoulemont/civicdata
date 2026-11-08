import { createFileRoute } from "@tanstack/react-router"

const Home = () => (
  <main>
    <h1>civicdata</h1>
    <p>Ask about the state of a country and get a sourced chart.</p>
  </main>
)

export const Route = createFileRoute("/")({ component: Home })
