import { expect, it } from "@effect/vitest"
import { Answered, Asked, Cited, Day, Down, Text } from "@repo/domain"
import { DateTime, Effect, FileSystem, Layer, Option, PlatformError, Schema } from "effect"

import { Probed, ProbedJson } from "../../eval/probes.ts"
import { ArchiveError, bytesOf, digest, json, ManifestJson, textOf } from "./model.ts"
import { pack } from "./pack.ts"
import { list, pull, push, Store } from "./transfer.ts"

type Probed = typeof Probed.Type

it.effect("decodes political citation timestamps when restoring saved answer JSON", () =>
  Effect.gen(function* () {
    const base = probe()
    const row = base.rows[0]

    if (row === undefined) throw new Error("Missing row")

    const answer = {
      ...base,
      rows: [
        {
          ...row,
          ending: Answered.make({
            blocks: [
              Text.make({
                text: "The [election](cite:0) was held.",
                cites: [
                  Cited.cases.Election.make({
                    election: {
                      country: "DEU",
                      ballot: "parliament",
                      date: Day.make("2025-02-23"),
                      lastRound: null,
                      citation: {
                        publisher: "Official",
                        url: "https://example.com/election",
                        retrievedAt: yield* DateTime.now,
                      },
                    },
                  }),
                ],
              }),
            ],
          }),
        },
      ],
    }

    const encoded = yield* Schema.encodeEffect(ProbedJson)(answer)

    expect(yield* Schema.decodeEffect(ProbedJson)(encoded)).toEqual(answer)
  }),
)

const probe = (vote: Probed["rows"][number]["vote"] = null): Probed => ({
  probe: {
    id: "everyday-001",
    voice: "everyday",
    group: "Prices",
    questions: ["Where?"],
    note: null,
  },
  rows: [
    {
      asked: "2026-11-11T00:00:00Z",
      questions: ["Where?"],
      changed: [],
      ending: Asked.make({ question: "Which country?", choices: ["France", "Japan"] }),
      steps: [],
      took: 5,
      model: "test",
      version: null,
      trace: null,
      vote,
      changes: 0,
      downloads: 0,
      shares: 0,
    },
  ],
  failure: null,
})

const missing = (path: string) =>
  PlatformError.badArgument({ module: "FileSystem", method: "readFile", description: path })

const rig = Effect.fn("Evals.testRig")(function* () {
  const body = yield* Schema.encodeEffect(ProbedJson)(probe(Down.make({ reason: "text" })))

  const files = new Map<string, Uint8Array>([
    ["/source/everyday-001.json", bytesOf(body)],
    ["/source/review.md", bytesOf("Review")],
    ["/server/eval/probes.ts", bytesOf("Questions")],
    ["/server/eval/probes.md", bytesOf("Rubric")],
    ["/server/eval/recordings/world-bank/fixture.gz", bytesOf("Recording")],
  ])

  const directories = new Set([
    "/source",
    "/server/eval/recordings",
    "/server/eval/recordings/world-bank",
  ])

  const fs = FileSystem.layerNoop({
    exists: (path) => Effect.succeed(files.has(path) || directories.has(path)),
    readFile: (path) =>
      Effect.suspend(() => {
        const found = files.get(path)

        return found === undefined ? Effect.fail(missing(path)) : Effect.succeed(found)
      }),
    makeDirectory: (path, options) =>
      Effect.suspend(() => {
        if (directories.has(path) && !options?.recursive)
          return Effect.fail(
            PlatformError.badArgument({
              module: "FileSystem",
              method: "makeDirectory",
              description: path,
            }),
          )
        directories.add(path)

        return Effect.void
      }),
    writeFile: (path, contents) =>
      Effect.sync(() => {
        files.set(path, contents)
      }),
    readDirectoryEntries: (path) =>
      Effect.sync(() => {
        const result: Array<FileSystem.DirectoryEntry> = []

        for (const file of files.keys()) {
          if (file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/")) {
            result.push({ name: file.slice(path.length + 1), type: "File" })
          }
        }

        for (const dir of directories) {
          if (dir.startsWith(`${path}/`) && !dir.slice(path.length + 1).includes("/")) {
            result.push({ name: dir.slice(path.length + 1), type: "Directory" })
          }
        }

        return result
      }),
  })

  const objects = new Map<string, Uint8Array>()

  const store = Layer.succeed(
    Store,
    Store.of({
      get: (key) => Effect.sync(() => Option.fromUndefinedOr(objects.get(key))),
      put: (key, value) =>
        Effect.sync(() => {
          objects.set(key, value)
        }),
      list: (prefix) =>
        Effect.sync(() => [...objects.keys()].filter((key) => key.startsWith(prefix))),
    }),
  )

  return { files, directories, objects, layer: Layer.merge(fs, store) }
})

it.effect("packs separate votes, uploads idempotently and restores every original byte", () =>
  Effect.gen(function* () {
    const test = yield* rig()
    yield* Effect.gen(function* () {
      const packed = yield* pack("/source", {
        out: "/archive",
        server: "/server",
        reviewer: "reviewer",
      })

      expect(packed.manifest.origin).toBeNull()
      expect(packed.manifest.reviews).toHaveLength(1)
      const answer = packed.manifest.answers[0]

      if (answer === undefined) throw new Error("Missing answer")

      const clean = yield* Schema.decodeEffect(ProbedJson)(
        textOf(test.files.get(`/archive/objects/${answer.digest}`) ?? new Uint8Array()),
      )

      expect(clean.rows[0]?.vote).toBeNull()
      const id = yield* push("/archive")
      expect(yield* push("/archive")).toBe(id)
      expect((yield* list()).map((x) => x.id)).toEqual([id])
      yield* pull(id, "/restored")
      expect(test.files.get("/restored/run/everyday-001.json")).toEqual(
        test.files.get("/source/everyday-001.json"),
      )
      expect(test.files.get("/restored/run/review.md")).toEqual(bytesOf("Review"))
      expect(test.files.has("/restored/complete")).toBe(true)
      expect(yield* Effect.flip(pull(id, "/restored"))).toMatchObject({
        detail: expect.stringContaining("already exists"),
      })
    }).pipe(Effect.provide(test.layer))
  }),
)

it.effect("keeps an interrupted upload undiscoverable and resumes it", () =>
  Effect.gen(function* () {
    const test = yield* rig()
    yield* Effect.gen(function* () {
      const packed = yield* pack("/source", { out: "/archive", server: "/server" })

      const broken = Layer.succeed(
        Store,
        Store.of({
          get: (key) => Effect.succeed(Option.fromUndefinedOr(test.objects.get(key))),
          put: () => Effect.fail(new ArchiveError({ operation: "upload", detail: "Disconnected" })),
          list: () => Effect.succeed([]),
        }),
      )

      expect(yield* Effect.flip(push("/archive").pipe(Effect.provide(broken)))).toMatchObject({
        detail: "Disconnected",
      })
      expect([...test.objects.keys()].some((key) => key.includes("/runs/"))).toBe(false)
      expect(yield* push("/archive")).toBe(packed.id)
    }).pipe(Effect.provide(test.layer))
  }),
)

it.effect("rejects remote corruption before creating the destination", () =>
  Effect.gen(function* () {
    const test = yield* rig()
    yield* Effect.gen(function* () {
      const packed = yield* pack("/source", { out: "/archive", server: "/server" })
      yield* push("/archive")
      const file = packed.manifest.files[0]

      if (file === undefined) throw new Error("Missing file")
      test.objects.set(`evals/v1/objects/${file.digest}`, bytesOf("Corrupted"))
      expect(yield* Effect.flip(pull(packed.id, "/restored"))).toMatchObject({
        detail: expect.stringContaining("corrupt"),
      })
      expect(test.directories.has("/restored")).toBe(false)
      expect(yield* Effect.flip(push("/archive"))).toMatchObject({
        detail: expect.stringContaining("Conflicting"),
      })
    }).pipe(Effect.provide(test.layer))
  }),
)

it.effect("rejects missing objects, malformed manifests and unsafe paths", () =>
  Effect.gen(function* () {
    const test = yield* rig()
    yield* Effect.gen(function* () {
      const packed = yield* pack("/source", { out: "/archive", server: "/server" })
      yield* push("/archive")
      test.objects.delete(`evals/v1/objects/${packed.manifest.snapshot.rubric}`)
      expect(yield* Effect.flip(pull(packed.id, "/missing"))).toMatchObject({
        detail: expect.stringContaining("Missing"),
      })
      const invalid = json({ version: 999 })
      const invalidId = digest(invalid)
      test.objects.set(`evals/v1/runs/${invalidId}.json`, invalid)
      expect(yield* Effect.flip(pull(invalidId, "/bad"))).toHaveProperty("_tag", "SchemaError")
      const encoded = yield* Schema.encodeEffect(ManifestJson)(packed.manifest)
      const unsafe = bytesOf(encoded.replace('"everyday-001.json"', '"../escape.json"'))
      const unsafeId = digest(unsafe)
      test.objects.set(`evals/v1/runs/${unsafeId}.json`, unsafe)
      expect(yield* Effect.flip(pull(unsafeId, "/unsafe"))).toHaveProperty("_tag", "SchemaError")
      expect(test.directories.has("/unsafe")).toBe(false)
    }).pipe(Effect.provide(test.layer))
  }),
)
