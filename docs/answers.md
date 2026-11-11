# Answers

A conversation deletes itself 30 days after its last question, and Grafana Cloud keeps its traces 14 days. To find answers that went wrong after both are gone, and to turn real questions into eval cases, each stage keeps a log of the answers it gave in the `answers` table of its D1 database.

## What a row holds

The conversation writes a row each time it keeps a turn: answered, asked back, unanswered, cut short after 18 rounds, or stopped. An answer that fails, such as when the model is unavailable, keeps no turn and writes no row.

| Column      | Holds                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | a SHA-256 hash of the conversation's Durable Object id and the turn's place                                                          |
| `asked`     | when the question came, as ISO 8601 UTC                                                                                              |
| `questions` | the conversation's questions up to this one, oldest first, scrubbed, as a JSON array                                                 |
| `changed`   | the charts the person changed before asking, each with its turn and place, as JSON                                                   |
| `ending`    | how the answer ended, with its charts and text, as the domain's `Ending` in JSON                                                     |
| `steps`     | what the agent did: searches, fetches and the calls the server sent back, as JSON                                                    |
| `took`      | milliseconds from the question to the ending                                                                                         |
| `model`     | the model that answered: `OPENAI_MODEL`, or the default in `packages/server/src/OpenAi.ts`                                           |
| `version`   | the commit deployed, when CI set it                                                                                                  |
| `trace`     | the trace id, to open the full trace in Grafana while it is kept                                                                     |
| `vote`      | what the person thought of the answer, as the domain's `Vote` in JSON: `Up`, or `Down` with an optional reason; null until they vote |
| `changes`   | times the person changed one of the answer's charts, changing back included                                                          |
| `downloads` | times the person downloaded a chart's data as CSV                                                                                    |
| `shares`    | times the person copied a chart's link                                                                                               |

A row never holds the conversation's id, since whoever has it can read the conversation, nor an IP address, user agent or referrer. Its own id lets a vote find the row with nothing more stored: only this Worker can turn a conversation's link into its object's id, and the hash cannot be turned back. A conversation deleted after 30 days and asked again from the same link reuses its object, so its new answers replace the old rows at the same places. Its trace id does lead to the conversation id for the 14 days Grafana keeps the trace.

The conversation writes the row after the answer's last step goes out, so the page shows the ending before the write starts; it takes the next question once the write ends and the answer's stream closes. A write that fails or takes over 5 seconds is logged as a warning on the `Answers.log` span and dropped. The answer is kept either way.

## Votes

Under each answer that ended on its own (answered, unanswered or cut short, not asked back or stopped), the page asks "Was this answer useful?" with a thumbs up and a thumbs down. A thumbs down asks what went wrong: wrong measure, wrong countries, wrong years, missing data, wrong text, or something else. `PUT /api/conversations/<id>/turns/<turn>/vote` keeps the vote on the turn, so the page shows it again, and sets the row's `vote`. The last vote counts. The `Answers.vote` span records `civicdata.vote` (`up` or `down`) and `civicdata.vote.reason`.

## What people did with an answer

Few people vote, but every answer can show what the person did next. `show` adds one to `changes` each time it keeps a changed chart. Once the answer is kept, the CSV link and Copy link in its chart send `POST /api/conversations/<id>/turns/<turn>/actions` with `download` or `share`; on `/explore` they send nothing. The page shows nothing about these counts, and a count that fails to arrive is dropped. They are hints for triage, not a score: changing a chart can just mean exploring.

## Scrubbing

`scrub` in `packages/server/src/Answers.ts` replaces, in each question:

- an email address with `[email]`
- a run of nine or more digits with `[number]`, such as a phone, card or account number. Up to two spaces, dots, dashes or brackets may sit between digits. A run whose digits end in 000 is a round figure, such as "1 000 000 000 people", and stays.

It does not catch a name or an address written in words, so the log is pseudonymous, not anonymous. The home page tells visitors that questions are kept for a year and asks them not to include anything personal. The assistant's own text is not scrubbed.

## Retention

Each write deletes the rows asked more than 365 days ago. A stage that stops answering keeps its last rows until its D1 database is destroyed; `prod`'s survives `alchemy destroy` ([deploys.md](deploys.md)).

## Reading the log

Run SQL against a stage's database in the Cloudflare dashboard (Storage and databases, then D1, then the stage's database, then Console). For example, the answers of the last week that did not answer:

```sql
SELECT asked, questions, json_extract(ending, '$._tag') AS ending
FROM answers
WHERE asked >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
  AND json_extract(ending, '$._tag') IN ('Unanswered', 'Exhausted')
ORDER BY asked DESC
```

`asked` compares as text, so write the bound in the same ISO 8601 form, as `strftime` does here.

## Turning answers into eval cases

`pnpm --filter @civicdata/server run triage` prints the answers of the last 7 days worth a look, worst first. It reads the stage's log through Cloudflare's D1 API:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... DATABASE_ID=... DAYS=30 \
  pnpm --filter @civicdata/server run triage
```

The token needs D1 read access. `DATABASE_ID` is the stage's database, under Storage and databases, then D1, in the Cloudflare dashboard. `DAYS` is optional.

An answer is a candidate when the person voted it down (weighs 8), it was cut short or unanswered (4), the server sent charts back (1 each), or the person changed its charts (1 each change). One voted up is never a candidate. `eval/candidates.ts` holds the rules.

Each candidate prints as the start of a case for `packages/server/eval/cases.ts`, with why it is one and its trace id:

```ts
// 2026-11-10T12:00:00.000Z · voted down: countries · trace 4bf92f3577b34da6a3ce929d0e0e4736
{
  questions: ["Life expectancy in Brazil","Add Mexico"],
  // charted {"_tag":"Trend","indicator":"SP.DYN.LE00.IN","countries":["BRA"],"from":2000,"to":2002}
  accepts: [],
},
```

To keep one, paste it into `cases`, turn a `// shown` line into the case's `shown` View, and write what it `accepts` with the `Expected` constructors. The printed charts are what the agent did, not what it should have done. The questions are scrubbed, so check a `[number]` or `[email]` reads as a question the agent can answer. The next eval run records the case's source data; adding a case needs no run.
