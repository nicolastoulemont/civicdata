import { handle } from "@openfacts/server"
import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"

import type { Transport } from "@/api"

// Server only. Hands each request to the API handler in this Worker, so
// rendering a page or a card never sends a request out and back in.
export const inProcess: Transport = {
  baseUrl: "http://in-process",
  layer: FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, (input, init) => handle(new Request(input, init))),
    ),
  ),
}
