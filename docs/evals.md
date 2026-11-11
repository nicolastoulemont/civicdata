# Eval runs and archives

Read this before running, reviewing, archiving or restoring the assistant's evals. The probe review rubric is in [probes.md](../packages/server/eval/probes.md); production answer retention and promotion to regression cases are in [answers.md](answers.md).

## Run on request

Paid evals and probes call OpenAI. Run one only when the user asks for that run in the current task. Set `RUN_AGENT_EVAL=1` only for that request. Prompt changes, reviews, archive transfers and `pnpm check` need no paid run.

The server's `eval` script scores the charts accepted by `eval/cases.ts`. Its `probe` script saves answers without scoring them. Use the probe script's `-t` filter for a requested subset; Vitest matches the full name, including the model suite, so use `everyday-` rather than `^everyday-`. Check the selected count before treating a command as a completed run.

The harness reads the OpenAI key as local development does. Source responses replay from the committed recordings; missing requests go live and add recordings. Commit those additions. Refreshing recordings spends source request budgets and changes the comparison's inputs, so do it only as part of an explicitly requested refresh.

A new run records its code revision, dirty patch, untracked source files, questions and rubric in `context.json`, and copies each source response it uses under `inputs/recordings`. It writes each probe's turns even when the answer ends by asking a question. A top-level failure has no rows and an explicit failure. Run folders and local archives are gitignored.

Before handing off a run, account for every selected probe: saved rows, top-level failures, missing files, endings, source failures inside steps, and usage printed by the harness. A passing test only means execution finished. `SourceUnavailable` can be caught inside an answer that the harness counts as passed; a chart can coexist with a failed lookup.

## Retry without losing evidence

Inspect the final answer after a source failure. A fallback may have answered the question, or substituted a measure that changes it. Retry an incomplete lookup only within the user's requested run. When a source refuses requests because its budget is spent, let that budget recover instead of repeatedly asking it.

Keep each retry in its own run folder. If selecting a retry as the working answer, first preserve the earlier file under `attempts/<attempt-name>/`. Record the selection in the run report. Keep first-attempt counts separate from counts after retries; dropping failed attempts would make reliability look better than it was.

## Review a working copy

Apply [the probe rubric](../packages/server/eval/probes.md) to every selected answer row. Edit votes only in the working copy and write `review.md` beside it. Distinguish established errors, scope judgments and unverified claims. Probe notes are hypotheses about coverage, not evidence that a source lacks data.

Record the reviewer model and settings in the report. Report source availability separately from quality. An Up vote is not a full source audit, and a missing chart or necessary clarification is not automatically a Down vote.

Run triage on that folder and reconcile its candidates with the votes. Triage reads only probe filenames, not metadata JSON. Its JSON codec decodes political citation timestamps before passing rows to the candidate rules. Finish when every row has a vote, the counts agree, and edits outside votes are explained. Then pack and upload a new archive revision; never replace the earlier review.

## Pack, upload and restore

Use `pnpm evals --help` for command arguments and credentials. `pack` runs offline; `list`, `push` and `pull` use the account's R2 API with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The default bucket is `civicdata-evals`. Transfer commands never run the agent.

1. **Pack** a run folder into a new archive directory. A folder containing several runs also works. Keep a `batch.json` describing which folders are primary answers, retries or diagnostics, and which portions are reviewed. Pass the reviewer identity when known; leave it unknown when it was not captured.
2. **Push** that archive. The command validates local objects, preserves existing content-addressed objects, checks uploaded bytes and publishes the manifest last. A failed upload has no complete manifest; retry the same archive to resume.
3. **Pull** the returned archive id into a new directory. The command verifies the manifest, every object's SHA-256 and size, answer schemas and review references before restoring working files under `run/`. Existing destinations are refused. A `complete` marker is written last; a disk failure can leave an incomplete local folder, which should be inspected rather than overwritten.
4. **Verify** the restored run through triage and compare files with the source folder. Only then report the upload as complete. Keep the archive id in the issue or PR so another worktree can find it.

Each manifest references immutable objects: original working files byte-for-byte, canonical answers with votes removed, separate review votes tied to answer hashes and turns, and review reports. Changing a vote or answer produces a new manifest id while reusing unchanged objects. Concurrent writers of identical objects agree on their bytes; different revisions have different ids. The archive exposes no delete command.

The pack also includes the current questions, rubric and a compressed snapshot of source recordings. These are **archive-time** snapshots. `origin: null` means no run-start context was captured; do not infer an old code revision or exact historical source inputs from the import-time snapshot. For new runs, `context.json` and `inputs/recordings` supply that evidence. OpenAI's later output is still not guaranteed to be identical.

The bucket is private, retained and owned by its own Alchemy stack. Provision it with the infra package's `deploy:evals` script. App preview deployment and cleanup do not own it. It has no automatic result expiry: deleting a worktree must not delete paid run results or reviews. Source recordings stay in Git for offline replay; the archive is the durable copy of run artifacts.

## Today's imported batch

The [2026-11-11 receipt](evals/2026-11-11.md) identifies the archive and its review coverage. It preserves all surviving run folders and review evidence. Original run-start code patches and some early overwritten retry attempts were not captured. Those gaps stay explicit in `batch.json`; archiving cannot reconstruct them.
