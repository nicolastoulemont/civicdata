import { Ballot, Country, Day, Party, Publisher } from "@repo/domain"
import { Schema } from "effect"

// A governing party as its publisher records it, with the publisher's own id
// for it (PPEG's `party_id`, ParlGov's `party_id`) and whether the publisher
// names it as the head of government's party. Records checked by hand name
// parties without an id and never say which is the head's.
const PartyRecord = Schema.Struct({
  ...Party.fields,
  id: Schema.NullOr(Schema.NonEmptyString),
  lead: Schema.Boolean,
})

export interface PartyRecord extends Schema.Schema.Type<typeof PartyRecord> {}

// One government as its publisher records it: when it started, who headed
// it, and its governing parties, the head's party first. `until` is the day
// the publisher's records end, for a government still in office then; the
// sources record no other ends.
export const GovernmentRecord = Schema.Struct({
  country: Country,
  head: Schema.NonEmptyString,
  parties: Schema.Array(PartyRecord),
  start: Day,
  until: Schema.NullOr(Day),
  url: Schema.NonEmptyString,
  retrievedAt: Schema.DateTimeUtc,
})

export interface GovernmentRecord extends Schema.Schema.Type<typeof GovernmentRecord> {}

// One national election as its publisher records it, once however many
// parties or rounds its rows hold.
export const ElectionRecord = Schema.Struct({
  country: Country,
  ballot: Ballot,
  date: Day,
  lastRound: Schema.NullOr(Day),
  url: Schema.NonEmptyString,
  retrievedAt: Schema.DateTimeUtc,
})

export interface ElectionRecord extends Schema.Schema.Type<typeof ElectionRecord> {}

// A publisher's records could not be fetched, or did not decode.
export class ArchiveUnavailable extends Schema.TaggedError<
  ArchiveUnavailable,
  { readonly brand: unique symbol }
>()("ArchiveUnavailable", { publisher: Publisher, cause: Schema.Defect() }) {}
