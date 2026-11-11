import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Called only after the paid-run gate, before the first source/model request.
// No environment values or credential files enter this snapshot.
export const context = (root: string) => {
  const git = (args: ReadonlyArray<string>) =>
    execFileSync("git", [...args], { cwd: root, encoding: "utf8" })

  const untracked = git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "packages/server",
    "packages/domain",
    "packages/machine",
  ])
    .split("\0")
    .flatMap((path) =>
      /\.(?:ts|tsx|json|md)$/.test(path)
        ? [{ path, text: readFileSync(join(root, path), "utf8") }]
        : [],
    )

  return {
    version: 1,
    commit: git(["rev-parse", "HEAD"]).trim(),
    patch: git(["diff", "HEAD", "--binary"]),
    untracked,
    probes: readFileSync(join(root, "packages/server/eval/probes.ts"), "utf8"),
    rubric: readFileSync(join(root, "packages/server/eval/probes.md"), "utf8"),
  }
}
