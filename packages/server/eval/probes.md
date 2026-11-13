# Probes

The eval in `cases.ts` checks charts against answers we already know. Probes find the questions we don't handle yet. `probes.ts` holds 200 questions with no accepted chart: 100 asked by someone who knows the sources, and 100 asked the way most people ask, which is vague, loaded, sometimes built on a wrong premise, and about their own life more than about indicators. Some probes have a `note` that says what the probe tests.

A probe run asks every probe and writes down how the agent answered. Nothing scores the answers. A reviewer reads them, votes on each one, and `triage` turns the answers voted down into the start of eval cases.

Run, retry, archive and restore through [docs/evals.md](../../../docs/evals.md). The rules below govern answer review; execution passing is not a quality score. Probe notes are hypotheses to check against fetched evidence.

## Reviewing

Give the run folder to a strong model, or read it yourself. Before reading answers, read the product rules in `AGENTS.md`, the findings in `packages/server/src/research/assets/findings.json`, and the coverage of the political records in the README. A good answer meets all of these:

- It finds the measurable question inside the person's words and says which country, indicator and years it chose, and why.
- It says plainly what no chart can answer, and names the nearest measure it charts instead.
- It gives a cause only by citing a finding that covers that country and period. An election, government or event is never what moved a figure.
- It doesn't accept a false or loaded premise; the chart shows what the data says instead.
- It reads places as the person meant them: Holland, England, Dubai, Congo, Georgia, Africa, "here".
- It asks back only when it can't answer without knowing more, such as "my country", and answers otherwise.

Set each row's `vote` to `{ "_tag": "Up" }` or to `{ "_tag": "Down", "reason": ... }`, with the reason that fits best:

| Reason      | When                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `indicator` | The chart doesn't measure what was asked, or swaps in a nearby measure without saying so                                   |
| `countries` | A place read wrong, a region's members wrong, or an aggregate in a ranking of countries                                    |
| `years`     | The years differ from those the question names or needs                                                                    |
| `data`      | It says the data is missing when a source has it, or charts nothing without saying the data is missing                     |
| `text`      | A cause with no finding, an accepted false premise, a claim the chart contradicts, a forecast, or a needless question back |
| `other`     | Anything else; say what in the review                                                                                      |

An answer with no chart can earn an up vote when nothing measures the question and it says so. In a chain of questions, vote on each turn.

Then write `review.md` in the run folder:

- one line per down vote: the probe id, the reason, and one sentence on what went wrong
- the patterns across probes, worst first, each with the probes that show it
- the up and down counts for each voice and group

## Turning findings into cases

```sh
RUN=eval/runs/<run> pnpm --filter @repo/server run triage
```

It ranks the run's answers as it ranks the production log (`eval/candidates.ts`): a down vote first, then answers cut short, unanswered, or with charts the server sent back. An up vote leaves an answer out. Each answer prints as the start of a case for `cases.ts`. Finish it as `docs/answers.md` describes. Keep the probe in `probes.ts` too: ids number probes in order, so removing one renames those after it, and the probe still gets its text reviewed.
