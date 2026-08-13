import { expect } from "bun:test"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as AppConfig from "../src/app/app-config.js"
import * as CommandRunner from "../src/app/command-runner.js"
import * as GitDiff from "../src/app/git-diff.js"
import * as BiomeFormat from "../src/checks/static/biome-format.js"
import * as BiomeLint from "../src/checks/static/biome-lint.js"
import * as CircularDeps from "../src/checks/static/circular-deps.js"
import * as NoBareCatchAll from "../src/checks/static/no-bare-catchall.js"
import * as NoBarrelImports from "../src/checks/static/no-barrel-imports.js"
import * as NoDebug from "../src/checks/static/no-debug.js"
import * as Typecheck from "../src/checks/static/typecheck.js"
import type { CheckRunner } from "../src/domain/check-result.js"
import { effectTests } from "./effect-test.js"

type CheckEnv =
  | Typecheck.Typecheck
  | BiomeLint.BiomeLint
  | BiomeFormat.BiomeFormat
  | CircularDeps.CircularDeps
  | NoDebug.NoDebug
  | NoBarrelImports.NoBarrelImports
  | NoBareCatchAll.NoBareCatchAll

const platform = Layer.mergeAll(BunServices.layer, AppConfig.layer)
const commandRunner = Layer.provide(CommandRunner.layer, platform)
const gitDiff = Layer.provide(GitDiff.layer, Layer.mergeAll(platform, commandRunner))

const foundation = Layer.mergeAll(platform, commandRunner, gitDiff)

const checks = Layer.mergeAll(
  Typecheck.layer,
  BiomeLint.layer,
  BiomeFormat.layer,
  CircularDeps.layer,
  NoDebug.layer,
  NoBarrelImports.layer,
  NoBareCatchAll.layer,
)

const provided = Layer.provide(checks, foundation) as unknown as Layer.Layer<CheckEnv, never>

const { test } = effectTests<CheckEnv>(provided)

test("every check produces a structured result", () =>
  Effect.gen(function* () {
    const checks_ = yield* Effect.all([
      Effect.service(Typecheck.Typecheck),
      Effect.service(BiomeLint.BiomeLint),
      Effect.service(BiomeFormat.BiomeFormat),
      Effect.service(CircularDeps.CircularDeps),
      Effect.service(NoDebug.NoDebug),
      Effect.service(NoBarrelImports.NoBarrelImports),
      Effect.service(NoBareCatchAll.NoBareCatchAll),
    ] as const)
    const results = yield* Effect.all(
      checks_.map((check: CheckRunner) => check.run),
      { concurrency: 1 },
    )
    return results
  }).pipe(
    Effect.map((results) => {
      const summaries = results.map((result) => ({ id: result.id, status: result.status, summary: result.summary }))
      console.log(JSON.stringify(summaries, null, 2))
      for (const result of results) {
        expect(result.id).toEqual(expect.any(String))
        expect(["pass", "fail", "warn", "skipped"]).toContain(result.status)
        expect(result.durationMs).toBeGreaterThanOrEqual(0)
      }
      return results
    }),
  ))
