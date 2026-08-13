import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { AppConfig, type AppConfigShape } from "../../app/app-config.js"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { fail, instrument, pass, warn } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"

const meta = { id: "11", job: "tests", name: "Coverage gate" } as const

const COMMAND_ERROR_TAG = "@app/CommandRunner.CommandError"

const ALL_FILES_LINE = /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/

const parseCoverage = (output: string): number | undefined => {
  const match = ALL_FILES_LINE.exec(output)
  return match === null ? undefined : Number(match[2])
}

export interface CoverageGateShape extends CheckRunner {}
export class CoverageGate extends Context.Service<CoverageGate, CoverageGateShape>()("@checks/tests/CoverageGate") {}

export const layer = Layer.effect(
  CoverageGate,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const config: AppConfigShape = yield* AppConfig
    const threshold = config.gates.coverageThreshold

    const run = instrument(meta)(
      runner
        .run({ command: "bun", args: ["test", "--coverage"], timeoutMillis: 600_000, env: { BOT_REVIEW_NESTED: "1" } })
        .pipe(
          Effect.map((result) => {
            const output = `${result.stderr}\n${result.stdout}`
            const coverage = parseCoverage(output)
            if (coverage === undefined) {
              return warn("Coverage report not found in output", "bun test --coverage produced no parsable summary.")
            }
            if (result.exitCode !== 0) {
              return fail(`Tests failed before coverage was computed (exit ${result.exitCode})`, tail(output))
            }
            return coverage < threshold
              ? fail(
                  `Line coverage ${coverage}% is below the ${threshold}% threshold`,
                  `All files line coverage: ${coverage}%\nThreshold: ${threshold}%`,
                )
              : pass(`Line coverage ${coverage}% meets the ${threshold}% threshold`)
          }),
          Effect.catchTag(COMMAND_ERROR_TAG, (error) =>
            Effect.succeed(warn(`Could not run "bun test --coverage" — ${error.message}`)),
          ),
        ),
    )

    return CoverageGate.of({ ...meta, run })
  }),
)

const tail = (text: string, maxLines = 30): string =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines)
    .join("\n") || "no output"
