import { Schema } from "effect"

import { Finding } from "./Finding.ts"
import { Paper } from "./Paper.ts"
import { type Ballot, Election, Event, Government, Reform } from "./Politics.ts"

// A record's id, as the agent reads it in a lookup:
// "government:FRA:2017-05-15", "election:FRA:president:2017-04-23",
// "event:financial-crisis", "reform:fr-pensions-2010-woerth",
// "finding:euro-crisis-multipliers".
export const RecordId = Schema.String.check(
  Schema.isPattern(/^(?:government|election|event|reform|finding|paper):\S+$/),
).pipe(Schema.brand("RecordId"))

export type RecordId = typeof RecordId.Type

// One record the agent's words can cite: a political record, or a research
// finding.
export const Cited = Schema.TaggedUnion({
  Government: { government: Government },
  Election: { election: Election },
  Event: { event: Event },
  Reform: { reform: Reform },
  Finding: { finding: Finding },
  Paper: { paper: Paper },
})

export type Cited = typeof Cited.Type

// A record's id. A country has one government starting on a day, and one
// election of a ballot on a polling day; events, reforms and findings have
// ids of their own.
export const idOf = (cited: Cited): RecordId =>
  RecordId.make(
    Cited.match(cited, {
      Government: ({ government }) => `government:${government.country}:${government.start}`,
      Election: ({ election }) =>
        `election:${election.country}:${election.ballot}:${election.date}`,
      Event: ({ event }) => `event:${event.id}`,
      Reform: ({ reform }) => `reform:${reform.id}`,
      Finding: ({ finding }) => `finding:${finding.id}`,
      Paper: ({ paper }) => `paper:${paper.id}`,
    }),
  )

// What each election chose, inside a sentence: "the 2017 presidential
// election".
const ballotNames: Record<Ballot, string> = {
  parliament: "general election",
  president: "presidential election",
  "president-indirect": "indirect presidential election",
}

// The name the agent's words show for a record they cite: a government by
// its head, an election by its year and ballot ("2017 presidential
// election"), an event, a reform or a finding by its own name.
export const nameOf = (cited: Cited) =>
  Cited.match(cited, {
    Government: ({ government }) => government.head,
    Election: ({ election }) => `${election.date.slice(0, 4)} ${ballotNames[election.ballot]}`,
    Event: ({ event }) => event.name,
    Reform: ({ reform }) => reform.name,
    Finding: ({ finding }) => finding.name,
    Paper: ({ paper }) => paper.study.title,
  })
