import { createFileRoute, Outlet } from "@tanstack/react-router"

import { Layout } from "@/history/Layout"

// The home page and conversations, beside the list of past conversations.
const Chat = () => (
  <Layout>
    <Outlet />
  </Layout>
)

export const Route = createFileRoute("/_chat")({ component: Chat })
