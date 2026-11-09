import { createFileRoute, Outlet } from "@tanstack/react-router"
import { Effect, Option, Schema } from "effect"

import { Layout } from "@/history/Layout"
import { Section, Settings } from "@/settings/Settings"

// ?settings= names the open section. Any other value leaves Settings closed:
// it decodes to undefined rather than to no key, because the router keeps
// the raw value of a key the decoded search leaves out.
const Search = Schema.Struct({
  settings: Schema.optional(
    Schema.UndefinedOr(Section).pipe(
      Schema.catchDecoding(() => Effect.succeed(Option.some(undefined))),
    ),
  ),
})

// The home page and conversations, beside the list of past conversations.
// ?settings= opens Settings over them, so the page under it stays mounted.
const Chat = () => {
  const { settings } = Route.useSearch()

  return (
    <>
      <Layout>
        <Outlet />
      </Layout>
      {settings === undefined ? null : <Settings section={settings} />}
    </>
  )
}

export const Route = createFileRoute("/_chat")({
  validateSearch: Schema.decodeUnknownSync(Search),
  component: Chat,
})
