import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { GitDiff, type GitDiffShape } from "../../app/git-diff.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { grepCheck } from "../grep-files.js"

const meta = { id: "18", job: "static", name: "No bare Effect.catchAll" } as const

const BARE_CATCH_ALL = /\.pipe\(\s*Effect\.catchAll\s*\(/

export interface NoBareCatchAllShape extends CheckRunner {}
export class NoBareCatchAll extends Context.Service<NoBareCatchAll, NoBareCatchAllShape>()(
  "@checks/static/NoBareCatchAll",
) {}

export const layer = Layer.effect(
  NoBareCatchAll,
  Effect.gen(function* () {
    const gitDiff: GitDiffShape = yield* GitDiff
    const fs = yield* FileSystem.FileSystem
    const run = grepCheck({
      ...meta,
      regex: BARE_CATCH_ALL,
      skipShebangScripts: false,
      passSummary: "No bare Effect.catchAll patterns in changed code",
      failSummary: "Bare Effect.catchAll patterns found in changed code",
    })(gitDiff, fs)
    return NoBareCatchAll.of({ ...meta, run })
  }),
)
