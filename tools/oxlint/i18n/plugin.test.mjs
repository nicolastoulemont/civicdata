import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const plugin = fileURLToPath(new URL("./plugin.mjs", import.meta.url))

const lint = (source) => {
  const directory = mkdtempSync(join(tmpdir(), "civicdata-i18n-"))

  try {
    const config = join(directory, ".oxlintrc.json")
    const fixture = join(directory, "App.tsx")
    writeFileSync(
      config,
      JSON.stringify({
        jsPlugins: [{ name: "i18n", specifier: plugin }],
        rules: { "i18n/no-raw-text": "error" },
      }),
    )
    writeFileSync(fixture, source)

    const result = spawnSync(
      resolve("node_modules/.bin/oxlint"),
      ["-c", config, "--format=json", fixture],
      { encoding: "utf8" },
    )

    assert.equal(result.error, undefined)
    const output = JSON.parse(result.stdout)

    return output.diagnostics.filter((item) => item.code === "i18n(no-raw-text)")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

await test("rejects raw JSX text, accessible names, placeholders, branches, templates, and option labels", () => {
  const failures = lint(
    'const options = [{label:"French"}]; const App=()=> <section aria-label="Settings"><input placeholder={"Ask a question"}/><p>Hello</p>{ready ? "Ready" : `Waiting ${count}`}<button>{"Save"}</button></section>',
  )

  assert.equal(failures.length, 7)
})

await test("accepts i18n calls, source data, brand names, punctuation, and technical attributes", () => {
  assert.deepEqual(
    lint(
      'const App=()=> <section className="flex gap-2" data-state="loading"><p>civicdata</p><button aria-label={t($=>$.save)}>{t($=>$.save)}</button><span>{source.title}</span><span>{count}</span><span> / </span><p>Eurostat</p><input placeholder={t($=>$.question)}/></section>',
    ),
    [],
  )
})

await test("follows local constants and object members, with a guard for cyclic bindings", () => {
  assert.equal(
    lint(
      'const greeting="Hello"; const copy={save:"Save"};const App=()=> <p>{greeting}{copy.save}</p>',
    ).length,
    2,
  )
  assert.deepEqual(lint("const a=b;const b=a;const App=()=> <p>{a}</p>"), [])
})
