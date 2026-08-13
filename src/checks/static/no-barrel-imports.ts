import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { GitDiff, type GitDiffShape } from "../../app/git-diff.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { grepCheck } from "../grep-files.js"

const meta = { id: "17", job: "static", name: "No effect barrel imports" } as const

const BARREL_IMPORT = /\bimport\s+(?:type\s+)?\{[^}]*\}\s*from\s*["']effect["']/

export interface NoBarrelImportsShape extends CheckRunner {}
export class NoBarrelImports extends Context.Service<NoBarrelImports, NoBarrelImportsShape>()(
  "@checks/static/NoBarrelImports",
) {}

export const layer = Layer.effect(
  NoBarrelImports,
  Effect.gen(function* () {
    const gitDiff: GitDiffShape = yield* GitDiff
    const fs = yield* FileSystem.FileSystem
    const run = grepCheck({
      ...meta,
      regex: BARREL_IMPORT,
      skipShebangScripts: false,
      passSummary: 'No barrel-style imports from "effect" in changed code',
      failSummary: 'Barrel-style imports from "effect" found in changed code',
    })(gitDiff, fs)
    return NoBarrelImports.of({ ...meta, run })
  }),
)
