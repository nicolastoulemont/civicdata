import { Cited, Day, End, Politics } from "@civicdata/domain"
import { DateTime, Option, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { cite } from "../src/Citations.ts"
import events from "../src/official/events.json"

// Mariano Rajoy's government of the People's Party, and the financial crisis
// as events.json records it.
const government = Cited.cases.Government.make({
  government: {
    country: "ESP",
    head: "Mariano Rajoy",
    parties: [{ name: "People's Party", abbreviation: "PP" }],
    color: null,
    start: Day.make("2011-12-21"),
    end: End.cases.Next.make({ day: Day.make("2018-06-07") }),
    citation: {
      publisher: "PPEG",
      url: "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip",
      retrievedAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
    },
  },
})

const [crisis] = Schema.decodeUnknownSync(Politics.fields.events)(
  events.filter((event) => event.id === "financial-crisis"),
)

if (crisis === undefined) throw new Error("The financial crisis is missing from events.json")

const event = Cited.cases.Event.make({ event: crisis })

// The agent looked up both records.
const records = new Map<string, Cited>([
  ["government:ESP:2011-12-21", government],
  ["event:financial-crisis", event],
])

describe("cite", () => {
  it("links each cited record by its name, in the order cited", () => {
    expect(
      cite(
        "Youth unemployment in Spain peaked in 2013 under [[government:ESP:2011-12-21]], after the [[ event:financial-crisis ]].",
        records,
      ),
    ).toEqual(
      Option.some({
        text: "Youth unemployment in Spain peaked in 2013 under [Mariano Rajoy](cite:0), after the [Global financial crisis and Great Recession](cite:1).",
        cites: [government, event],
      }),
    )
  })

  it("keeps words that cite nothing as they are", () => {
    expect(cite("Spain peaked in 2013.", records)).toEqual(
      Option.some({ text: "Spain peaked in 2013.", cites: [] }),
    )
  })

  it("cites nothing when the agent did not look up a record", () => {
    expect(cite("Spain peaked in 2013 under [[government:ESP:2018-06-07]].", records)).toEqual(
      Option.none(),
    )
  })
})
