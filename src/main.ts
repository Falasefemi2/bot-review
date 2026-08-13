import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as AiReviewer from "./app/ai-reviewer.js"
import type { AppConfigShape, CheckJobName } from "./app/app-config.js"
import * as AppConfig from "./app/app-config.js"
import * as CommandRunner from "./app/command-runner.js"
import * as GitDiff from "./app/git-diff.js"
import * as GithubReporter from "./app/github-reporter.js"
import * as BunAudit from "./checks/deps/bun-audit.js"
import * as BundleSize from "./checks/deps/bundle-size.js"
import * as Knip from "./checks/deps/knip.js"
import * as LicenseScan from "./checks/deps/license-scan.js"
import * as LockfileSync from "./checks/deps/lockfile-sync.js"
import * as ProductionBuild from "./checks/deps/production-build.js"
import * as SastScan from "./checks/deps/sast-scan.js"
import * as SecretScan from "./checks/deps/secret-scan.js"
import * as BiomeFormat from "./checks/static/biome-format.js"
import * as BiomeLint from "./checks/static/biome-lint.js"
import * as CircularDeps from "./checks/static/circular-deps.js"
import * as NoBareCatchAll from "./checks/static/no-bare-catchall.js"
import * as NoBarrelImports from "./checks/static/no-barrel-imports.js"
import * as NoDebug from "./checks/static/no-debug.js"
import * as Typecheck from "./checks/static/typecheck.js"
import * as CoverageGate from "./checks/tests/coverage-gate.js"
import * as IntegrationTests from "./checks/tests/integration-tests.js"
import * as UnitTests from "./checks/tests/unit-tests.js"
import type { AIFinding } from "./domain/ai-review.js"
import { CheckResult, type CheckResult as CheckResultModel, type CheckRunner } from "./domain/check-result.js"

const CHECK_ERROR_TAG = "@app/CheckRunner.CheckError"

const platform = Layer.mergeAll(BunServices.layer, AppConfig.layer, FetchHttpClient.layer)
const commandRunner = Layer.provide(CommandRunner.layer, platform)
const gitDiff = Layer.provide(GitDiff.layer, Layer.mergeAll(platform, commandRunner))
const foundation = Layer.mergeAll(platform, commandRunner, gitDiff)

const staticChecks = Layer.mergeAll(
  Typecheck.layer,
  BiomeLint.layer,
  BiomeFormat.layer,
  CircularDeps.layer,
  NoDebug.layer,
  NoBarrelImports.layer,
  NoBareCatchAll.layer,
)

const testsChecks = Layer.mergeAll(UnitTests.layer, CoverageGate.layer, IntegrationTests.layer)

const depsChecks = Layer.mergeAll(
  BunAudit.layer,
  LockfileSync.layer,
  LicenseScan.layer,
  Knip.layer,
  ProductionBuild.layer,
  BundleSize.layer,
  SecretScan.layer,
  SastScan.layer,
)

const checkServices = Layer.mergeAll(staticChecks, testsChecks, depsChecks)
const providedChecks = Layer.provide(checkServices, foundation)
const aiReviewer = Layer.provide(AiReviewer.layer, foundation)
const githubReporter = Layer.provide(GithubReporter.layer, foundation)

const app = Layer.mergeAll(foundation, providedChecks, aiReviewer, githubReporter)

const runCheckSafely = (check: CheckRunner): Effect.Effect<CheckResultModel, never> =>
  check.run.pipe(
    Effect.catchTag(CHECK_ERROR_TAG, (error) =>
      Effect.succeed(
        CheckResult.make({
          id: check.id,
          job: check.job,
          name: check.name,
          status: "fail",
          summary: error.message,
          durationMs: 0,
        }),
      ),
    ),
  )

const runChecks = (checks: readonly CheckRunner[]): Effect.Effect<readonly CheckResultModel[], never> =>
  Effect.all(checks.map(runCheckSafely), { concurrency: "unbounded" })

const writeResults = (config: AppConfigShape, filename: string, payload: unknown) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(config.resultDir, { recursive: true })
    yield* fs.writeFileString(`${config.resultDir}/${filename}`, JSON.stringify(payload, null, 2))
  })

const runStatic = Effect.gen(function* () {
  const checks = yield* Effect.all([
    Effect.service(Typecheck.Typecheck),
    Effect.service(BiomeLint.BiomeLint),
    Effect.service(BiomeFormat.BiomeFormat),
    Effect.service(CircularDeps.CircularDeps),
    Effect.service(NoDebug.NoDebug),
    Effect.service(NoBarrelImports.NoBarrelImports),
    Effect.service(NoBareCatchAll.NoBareCatchAll),
  ] as const)
  const results = yield* runChecks(checks)
  yield* writeResults(yield* AppConfig.AppConfig, "static.json", results)
  return results
})

const runTests = Effect.gen(function* () {
  const checks = yield* Effect.all([
    Effect.service(UnitTests.UnitTests),
    Effect.service(CoverageGate.CoverageGate),
    Effect.service(IntegrationTests.IntegrationTests),
  ] as const)
  const results = yield* runChecks(checks)
  yield* writeResults(yield* AppConfig.AppConfig, "tests.json", results)
  return results
})

const runDeps = Effect.gen(function* () {
  const checks = yield* Effect.all([
    Effect.service(BunAudit.BunAudit),
    Effect.service(LockfileSync.LockfileSync),
    Effect.service(LicenseScan.LicenseScan),
    Effect.service(Knip.Knip),
    Effect.service(ProductionBuild.ProductionBuild),
    Effect.service(BundleSize.BundleSize),
    Effect.service(SecretScan.SecretScan),
    Effect.service(SastScan.SastScan),
  ] as const)
  const results = yield* runChecks(checks)
  yield* writeResults(yield* AppConfig.AppConfig, "deps.json", results)
  return results
})

const runAi = Effect.gen(function* () {
  const ai = yield* AiReviewer.AiReviewer
  const outcome = yield* ai.review().pipe(
    Effect.match({
      onFailure: (error) => ({ findings: [] as readonly AIFinding[], note: `AI review skipped: ${error.message}` }),
      onSuccess: (findings) => ({ findings, note: undefined as string | undefined }),
    }),
  )
  yield* writeResults(yield* AppConfig.AppConfig, "ai.json", outcome)
  return outcome
})

const ReadResultsFile = Schema.Array(CheckResult)

const readResults = (config: AppConfigShape, filename: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const raw = yield* fs.readFileString(`${config.resultDir}/${filename}`).pipe(
      Effect.match({
        onFailure: () => undefined as string | undefined,
        onSuccess: (value) => value,
      }),
    )
    if (raw === undefined) return [] as readonly CheckResultModel[]
    const parsed = yield* Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => undefined })
    if (parsed === undefined) return [] as readonly CheckResultModel[]
    return yield* Schema.decodeUnknownEffect(ReadResultsFile)(parsed).pipe(
      Effect.map((value) => value as readonly CheckResultModel[]),
      Effect.orElseSucceed(() => [] as readonly CheckResultModel[]),
    )
  })

const AiResultsFile = Schema.Struct({
  findings: Schema.Array(Schema.Any),
  note: Schema.optionalKey(Schema.String),
})

const readAiResults = (config: AppConfigShape) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const raw = yield* fs.readFileString(`${config.resultDir}/ai.json`).pipe(
      Effect.match({
        onFailure: () => undefined as string | undefined,
        onSuccess: (value) => value,
      }),
    )
    if (raw === undefined) return { findings: [], note: undefined }
    const parsed = yield* Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => undefined })
    if (parsed === undefined) return { findings: [], note: undefined }
    return yield* Schema.decodeUnknownEffect(AiResultsFile)(parsed).pipe(
      Effect.map((value) => ({
        findings: value.findings as readonly AIFinding[],
        note: value.note,
      })),
      Effect.orElseSucceed(() => ({ findings: [] as readonly AIFinding[], note: undefined })),
    )
  })

const statusCounts = (results: readonly CheckResultModel[]): Record<string, number> => {
  const counts: Record<string, number> = { pass: 0, fail: 0, warn: 0, skipped: 0 }
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1
  }
  return counts
}

const hasFailures = (results: readonly CheckResultModel[]): boolean =>
  results.some((result) => result.status === "fail")

const runReport = Effect.gen(function* () {
  const config = yield* AppConfig.AppConfig
  const reporter = yield* GithubReporter.GithubReporter

  const [staticResults, testsResults, depsResults] = yield* Effect.all([
    readResults(config, "static.json"),
    readResults(config, "tests.json"),
    readResults(config, "deps.json"),
  ])

  const aiOutcome = yield* readAiResults(config)
  const results = [...staticResults, ...testsResults, ...depsResults]

  yield* reporter.report({
    results,
    aiFindings: aiOutcome.findings,
    aiNote: aiOutcome.note,
  })

  const aiBlocks = config.gates.aiReviewBlocking && aiOutcome.findings.some((finding) => finding.severity === "high")
  const counts = statusCounts(results)
  yield* Effect.logInfo("bot-review.report", { counts, aiBlocks })
  return { aiBlocks, hasFailures: hasFailures(results) }
})

const run = Effect.gen(function* () {
  const config = yield* AppConfig.AppConfig
  const job: CheckJobName = config.checkJob
  yield* Effect.logInfo("bot-review.job_started", { checkJob: job })

  if (job === "static") {
    const results = yield* runStatic
    if (hasFailures(results)) return yield* Effect.fail(new Error(`static job failed (${results.length} checks)`))
  } else if (job === "tests") {
    const results = yield* runTests
    if (hasFailures(results)) return yield* Effect.fail(new Error(`tests job failed (${results.length} checks)`))
  } else if (job === "deps") {
    const results = yield* runDeps
    if (hasFailures(results)) return yield* Effect.fail(new Error(`deps job failed (${results.length} checks)`))
  } else if (job === "ai") {
    yield* runAi
  } else {
    const { aiBlocks, hasFailures: failed } = yield* runReport
    if (failed) return yield* Effect.fail(new Error("deterministic checks failed"))
    if (aiBlocks) return yield* Effect.fail(new Error("AI review is blocking and found high-severity findings"))
  }

  yield* Effect.logInfo("bot-review.job_completed", { checkJob: job })
})

BunRuntime.runMain(run.pipe(Effect.provide(app)))
