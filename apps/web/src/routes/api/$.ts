import { handle } from "@civicdata/server"
import { createFileRoute } from "@tanstack/react-router"

// Every /api request goes to the Effect HttpApi, which owns routing and errors.
export const Route = createFileRoute("/api/$")({
  server: { handlers: { ANY: ({ request }) => handle(request) } },
})
