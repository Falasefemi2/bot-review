import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { GitDiff, type GitDiffShape } from "../../app/git-diff.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { grepCheck } from "../grep-files.js"

const meta = { id: "5", job: "static", name: "No debug statements" } as const

const DEBUG_STATEMENT = /\bconsole\.log\s*\(|\bdebugger\b/

export interface NoDebugShape extends CheckRunner {}
export class NoDebug extends Context.Service<NoDebug, NoDebugShape>()("@checks/static/NoDebug") {}

export const layer = Layer.effect(
  NoDebug,
  Effect.gen(function* () {
    const gitDiff: GitDiffShape = yield* GitDiff
    const fs = yield* FileSystem.FileSystem
    const run = grepCheck({
      ...meta,
      regex: DEBUG_STATEMENT,
      skipShebangScripts: true,
      passSummary: "No console.log or debugger statements in changed code",
      failSummary: "console.log / debugger statements found in changed code",
    })(gitDiff, fs)
    return NoDebug.of({ ...meta, run })
  }),
)
