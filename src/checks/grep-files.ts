import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type { DiffContext, GitDiffShape } from "../app/git-diff.js"
import { fail, instrument, pass, warn } from "../domain/check-outcome.js"
import type { CheckResult } from "../domain/check-result.js"

const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"])

export const isCodeFile = (file: string): boolean => {
  const dot = file.lastIndexOf(".")
  return dot !== -1 && CODE_EXTENSIONS.has(file.slice(dot + 1).toLowerCase())
}

export interface SourceRow {
  readonly file: string
  readonly content: string
}

export interface LineMatch {
  readonly file: string
  readonly line: number
  readonly text: string
}

const PLATFORM_ERROR_TAG = "PlatformError"

const isSourceRow = (row: SourceRow | undefined): row is SourceRow => row !== undefined

const readSourceRows = (
  fs: FileSystem.FileSystem,
  files: readonly string[],
): Effect.Effect<readonly SourceRow[], never> =>
  Effect.forEach(files, (file) =>
    fs.readFileString(file).pipe(
      Effect.map((content) => ({ file, content }) satisfies SourceRow),
      // A file that appeared in the diff but cannot be read (deleted/renamed) is
      // not an error for a content scan — skip it.
      Effect.catchTag(PLATFORM_ERROR_TAG, () => Effect.succeed<SourceRow | undefined>(undefined)),
    ),
  ).pipe(Effect.map((rows) => rows.filter(isSourceRow)))

const diffContext = (gitDiff: GitDiffShape): Effect.Effect<Option.Option<DiffContext>, never> =>
  gitDiff.resolve().pipe(
    Effect.match({
      onFailure: () => Option.none(),
      onSuccess: (ctx) => Option.some(ctx),
    }),
  )

export interface GrepConfig {
  readonly id: string
  readonly job: "static"
  readonly name: string
  readonly regex: RegExp
  readonly skipShebangScripts: boolean
  readonly passSummary: string
  readonly failSummary: string
}

const SHEBANG = /^#!.*$/m

const isScript = (row: SourceRow): boolean => SHEBANG.test(row.content)

export const grepCheck =
  (config: GrepConfig) =>
  (gitDiff: GitDiffShape, fs: FileSystem.FileSystem): Effect.Effect<CheckResult, never> =>
    instrument({ id: config.id, job: config.job, name: config.name })(
      Effect.gen(function* () {
        const ctx = yield* diffContext(gitDiff)
        if (Option.isNone(ctx)) {
          return warn("Changed files could not be resolved", "The git diff is unavailable, so the scan was skipped.")
        }
        const changedCode = ctx.value.changedFiles.filter(isCodeFile)
        if (changedCode.length === 0) {
          return pass("No changed code files to scan")
        }
        const rows = yield* readSourceRows(fs, changedCode)
        const matches: LineMatch[] = []
        for (const row of rows) {
          if (config.skipShebangScripts && isScript(row)) continue
          const lines = row.content.split(/\r?\n/)
          for (const [index, line] of lines.entries()) {
            if (config.regex.test(line)) {
              matches.push({ file: row.file, line: index + 1, text: line.trim() })
            }
          }
        }
        return matches.length === 0 ? pass(config.passSummary) : fail(config.failSummary, formatMatches(matches))
      }),
    )

const MAX_DETAIL_LINES = 40

export const formatMatches = (matches: readonly LineMatch[]): string => {
  const shown = matches.slice(0, MAX_DETAIL_LINES)
  const remainder = matches.length - shown.length
  const lines = shown.map((match) => `${match.file}:${match.line}: ${match.text}`)
  const tail = remainder > 0 ? `\n… and ${remainder} more` : ""
  return lines.join("\n") + tail
}
