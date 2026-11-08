import { createFileRoute } from "@tanstack/react-router"

import { respond } from "@/card/respond"

export const Route = createFileRoute("/explore.png")({
  server: { handlers: { GET: ({ request }) => respond(request) } },
})
