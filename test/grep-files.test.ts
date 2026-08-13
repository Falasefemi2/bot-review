import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import type { GitDiffShape } from "../src/app/git-diff.js"
import { grepCheck } from "../src/checks/grep-files.js"
import type { CheckResult } from "../src/domain/check-result.js"
import { effectTests } from "./effect-test.js"

const makeGitDiff = (changedFiles: readonly string[]): GitDiffShape => ({
  resolve: () =>
    Effect.succeed({
      event: "push",
      baseSha: "base",
      headSha: "head",
      changedFiles,
      unifiedDiff: "",
    }),
})

const write = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    for (const [path, content] of Object.entries(files)) {
      const directory = path.slice(0, path.lastIndexOf("/"))
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.ignore)
      yield* fs.writeFileString(path, content)
    }
  })

const scan = (
  changedFiles: readonly string[],
  regex: RegExp,
  skipShebangScripts: boolean,
): Effect.Effect<CheckResult, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* grepCheck({
      id: "test",
      job: "static",
      name: "scan",
      regex,
      skipShebangScripts,
      passSummary: "clean",
      failSummary: "violations found",
    })(makeGitDiff(changedFiles), fs)
  })

const fsLayer = BunFileSystem.layer

const { test } = effectTests<FileSystem.FileSystem>(fsLayer)

test("reports violations for matching lines", () =>
  Effect.gen(function* () {
    yield* write({
      "tmp/scan/a.ts": "console.log('hello')\nexport const x = 1\n",
      "tmp/scan/b.ts": "export const y = 2\n",
    })
    const result = yield* scan(["tmp/scan/a.ts", "tmp/scan/b.ts"], /console\.log\s*\(/, false)
    if (result.status !== "fail") throw new Error("expected fail")
    if (!(result.details ?? "").includes("tmp/scan/a.ts:1")) throw new Error("expected match location")
  }))

test("ignores shebang scripts when configured", () =>
  Effect.gen(function* () {
    yield* write({
      "tmp/scan/shim.ts": "#!/usr/bin/env node\nconsole.log('x')\n",
    })
    const result = yield* scan(["tmp/scan/shim.ts"], /console\.log\s*\(/, true)
    if (result.status !== "pass") throw new Error("expected pass for shebang script")
  }))

test("passes when no changed files match", () =>
  Effect.gen(function* () {
    yield* write({
      "tmp/scan/a.ts": "export const x = 1\n",
    })
    const result = yield* scan(["tmp/scan/a.ts"], /debugger\b/, false)
    if (result.status !== "pass") throw new Error("expected pass")
  }))
