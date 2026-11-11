import { Source } from "@openfacts/domain"
import { Option, Schema } from "effect"

import { empty, Ledger, refuse, Slot, take } from "./Pace.ts"

const LedgerJson = Schema.fromJsonString(Ledger)
const SlotJson = Schema.fromJsonString(Slot)

const decodeSource = Schema.decodeUnknownOption(Source)
const decodeLedger = Schema.decodeUnknownOption(LedgerJson)

// What the limiter needs from its Durable Object's state.
interface State {
  readonly storage: {
    readonly get: (key: string) => Promise<string | undefined>
    readonly put: (key: string, value: string) => Promise<void>
  }
}

// The handlers Cloudflare calls on a Durable Object.
interface DurableObject {
  readonly fetch: (request: Request) => Promise<Response>
}

// The request limiter for one source, named by it, shared by every Worker.
// `POST /take?source=OECD&patience=2000` answers a Slot and records it;
// `POST /refused?source=OECD` starts the source's cooldown. Its storage holds
// the source's Ledger, so a limiter evicted from memory keeps its counts.
export class PaceObject implements DurableObject {
  readonly #state: State

  constructor(state: State) {
    this.#state = state
  }

  async fetch(request: Request) {
    const url = new URL(request.url)
    const source = decodeSource(url.searchParams.get("source"))
    const patience = Number(url.searchParams.get("patience") ?? "0")

    if (Option.isNone(source) || !Number.isFinite(patience))
      return new Response(null, { status: 400 })

    const stored = await this.#state.storage.get("ledger")
    const ledger = Option.getOrElse(decodeLedger(stored), () => empty)
    const now = Date.now()

    if (url.pathname === "/refused") {
      await this.#save(refuse(source.value, { ledger, now }))

      return new Response(null, { status: 204 })
    }

    if (url.pathname !== "/take") return new Response(null, { status: 404 })

    const next = take(source.value, { ledger, now, patience })

    await this.#save(next.ledger)

    return new Response(Schema.encodeSync(SlotJson)(next.slot), {
      headers: { "content-type": "application/json" },
    })
  }

  #save(ledger: Ledger) {
    return this.#state.storage.put("ledger", Schema.encodeSync(LedgerJson)(ledger))
  }
}
