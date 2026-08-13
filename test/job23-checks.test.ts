import { expect } from "bun:test"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as AppConfig from "../src/app/app-config.js"
import * as CommandRunner from "../src/app/command-runner.js"
import * as BunAudit from "../src/checks/deps/bun-audit.js"
import * as BundleSize from "../src/checks/deps/bundle-size.js"
import * as Knip from "../src/checks/deps/knip.js"
import * as LicenseScan from "../src/checks/deps/license-scan.js"
import * as LockfileSync from "../src/checks/deps/lockfile-sync.js"
import * as ProductionBuild from "../src/checks/deps/production-build.js"
import * as SastScan from "../src/checks/deps/sast-scan.js"
import * as SecretScan from "../src/checks/deps/secret-scan.js"
import * as CoverageGate from "../src/checks/tests/coverage-gate.js"
import * as IntegrationTests from "../src/checks/tests/integration-tests.js"
import * as UnitTests from "../src/checks/tests/unit-tests.js"
import type { CheckRunner } from "../src/domain/check-result.js"
import { effectTests } from "./effect-test.js"

type CheckEnv =
  | BunAudit.BunAudit
  | BundleSize.BundleSize
  | Knip.Knip
  | LicenseScan.LicenseScan
  | LockfileSync.LockfileSync
  | ProductionBuild.ProductionBuild
  | SastScan.SastScan
  | SecretScan.SecretScan
  | CoverageGate.CoverageGate
  | IntegrationTests.IntegrationTests
  | UnitTests.UnitTests

const platform = Layer.mergeAll(BunServices.layer, AppConfig.layer)
const commandRunner = Layer.provide(CommandRunner.layer, platform)
const foundation = Layer.mergeAll(platform, commandRunner)

const checks = Layer.mergeAll(
  BunAudit.layer,
  BundleSize.layer,
  Knip.layer,
  LicenseScan.layer,
  LockfileSync.layer,
  ProductionBuild.layer,
  SastScan.layer,
  SecretScan.layer,
  CoverageGate.layer,
  IntegrationTests.layer,
  UnitTests.layer,
)

const provided = Layer.provide(checks, foundation) as unknown as Layer.Layer<CheckEnv, never>

const { test } = effectTests<CheckEnv>(provided)

test("job 2 & 3 checks produce structured results", () =>
  Effect.gen(function* () {
    if (process.env.BOT_REVIEW_NESTED === "1") {
      return []
    }
    const tags: Array<Effect.Effect<CheckRunner, never, CheckEnv>> = [
      Effect.service(BunAudit.BunAudit),
      Effect.service(LockfileSync.LockfileSync),
      Effect.service(LicenseScan.LicenseScan),
      Effect.service(Knip.Knip),
      Effect.service(ProductionBuild.ProductionBuild),
      Effect.service(BundleSize.BundleSize),
      Effect.service(SecretScan.SecretScan),
      Effect.service(SastScan.SastScan),
      Effect.service(UnitTests.UnitTests),
      Effect.service(CoverageGate.CoverageGate),
      Effect.service(IntegrationTests.IntegrationTests),
    ]
    const checks_ = yield* Effect.all(tags)
    const results = yield* Effect.all(
      checks_.map((check: CheckRunner) => check.run),
      { concurrency: 2 },
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
