import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { AppConfigShape } from "../app/app-config.js"
import { AppConfig } from "../app/app-config.js"
import { type CommandError, CommandRunner, type CommandRunnerShape } from "../app/command-runner.js"

export interface DiffContext {
  readonly event: "pull_request" | "push"
  readonly baseSha: string
  readonly headSha: string
  readonly changedFiles: readonly string[]
  readonly unifiedDiff: string
}

export interface GitDiffShape {
  readonly resolve: () => Effect.Effect<DiffContext, GitDiffError>
}

export class GitDiffError extends Schema.TaggedError<GitDiffError>()("@app/GitDiff.GitDiffError", {
  message: Schema.String,
}) {}

export class GitDiff extends Context.Service<GitDiff, GitDiffShape>()("@app/GitDiff") {}

const COMMAND_ERROR_TAG = "@app/CommandRunner.CommandError"

const trimLines = (output: string): readonly string[] =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const asGitDiffError =
  (context: string) =>
  (error: CommandError): GitDiffError =>
    new GitDiffError({ message: `${context}: ${error.message}` })

const gitRevParse = (runner: CommandRunnerShape, ref: string) =>
  runner.run({ command: "git", args: ["rev-parse", ref] }).pipe(
    Effect.map((result) => result.stdout.trim()),
    Effect.mapError(asGitDiffError(`rev-parse ${ref}`)),
  )

const gitMergeBase = (
  runner: CommandRunnerShape,
  baseRef: string,
  headSha: string,
): Effect.Effect<string, GitDiffError> =>
  Effect.catchTag(
    runner
      .run({ command: "git", args: ["merge-base", `origin/${baseRef}`, headSha] })
      .pipe(Effect.map((result) => result.stdout.trim())),
    COMMAND_ERROR_TAG,
    // No merge base (e.g. shallow history): fall back to the base branch tip.
    () => gitRevParse(runner, `origin/${baseRef}`),
  )

const changedFilesBetween = (runner: CommandRunnerShape, baseSha: string, headSha: string) =>
  runner.run({ command: "git", args: ["diff", "--name-only", baseSha, headSha] }).pipe(
    Effect.map((result) => trimLines(result.stdout)),
    Effect.mapError(asGitDiffError("changed-files")),
  )

const unifiedDiffBetween = (runner: CommandRunnerShape, baseSha: string, headSha: string) =>
  runner.run({ command: "git", args: ["diff", "--no-color", baseSha, headSha] }).pipe(
    Effect.map((result) => result.stdout),
    Effect.mapError(asGitDiffError("unified-diff")),
  )

const resolvePullRequest = (
  runner: CommandRunnerShape,
  config: AppConfigShape,
): Effect.Effect<DiffContext, GitDiffError> =>
  Effect.gen(function* () {
    const baseRef = config.github.baseRef
    const headSha = config.github.sha
    if (baseRef === undefined || headSha === undefined) {
      return yield* Effect.fail(
        new GitDiffError({ message: "pull_request event requires GITHUB_BASE_REF and GITHUB_SHA" }),
      )
    }
    // Best-effort prefetch of the base branch so the diff can use a merge base;
    // not fatal if the ref is already present in the checkout.
    yield* runner.run({ command: "git", args: ["fetch", "origin", baseRef], timeoutMillis: 60_000 }).pipe(
      Effect.tapError((error) => Effect.logWarning("GitDiff.base_fetch_failed", error)),
      Effect.ignore,
    )
    const baseSha = yield* gitMergeBase(runner, baseRef, headSha)
    const changedFiles = yield* changedFilesBetween(runner, baseSha, headSha)
    const unifiedDiff = yield* unifiedDiffBetween(runner, baseSha, headSha)
    return { event: "pull_request", baseSha, headSha, changedFiles, unifiedDiff }
  })

const resolvePush = (runner: CommandRunnerShape, config: AppConfigShape): Effect.Effect<DiffContext, GitDiffError> =>
  Effect.gen(function* () {
    const headSha = config.github.sha
    if (headSha === undefined) {
      return yield* Effect.fail(new GitDiffError({ message: "push event requires GITHUB_SHA" }))
    }
    const parent = yield* Effect.catchTag(
      runner.run({ command: "git", args: ["rev-parse", "HEAD~1"] }),
      COMMAND_ERROR_TAG,
      // First commit on the branch has no parent: nothing to diff against.
      () => Effect.fail(new GitDiffError({ message: "no parent commit" })),
    ).pipe(
      Effect.map((result) => Option.some(result.stdout.trim())),
      Effect.catchTag(GitDiffError_tag, () => Effect.succeed(Option.none())),
    )
    if (Option.isNone(parent)) {
      return { event: "push", baseSha: headSha, headSha, changedFiles: [], unifiedDiff: "" }
    }
    const parentSha = parent.value
    const changedFiles = yield* changedFilesBetween(runner, parentSha, headSha)
    const unifiedDiff = yield* unifiedDiffBetween(runner, parentSha, headSha)
    return { event: "push", baseSha: parentSha, headSha, changedFiles, unifiedDiff }
  })

const GitDiffError_tag = "@app/GitDiff.GitDiffError"

export const layer = Layer.effect(
  GitDiff,
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    const config = yield* AppConfig

    const resolve = Effect.fn("GitDiff.resolve")(function* () {
      const eventName = config.github.eventName
      if (eventName === "pull_request") {
        return yield* resolvePullRequest(runner, config)
      }
      return yield* resolvePush(runner, config)
    })

    return GitDiff.of({ resolve })
  }),
)
