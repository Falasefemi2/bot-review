import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "16", job: "deps", name: "SAST (Semgrep)" } as const

export interface SastScanShape extends CheckRunner {}
export class SastScan extends Context.Service<SastScan, SastScanShape>()("@checks/deps/SastScan") {}

export const layer = Layer.effect(
  SastScan,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        { command: "semgrep", args: ["scan", "--config=auto", "--quiet"], timeoutMillis: 300_000 },
        { passSummary: "semgrep found no security issues", failSummary: "semgrep found security issues" },
      ),
    )
    return SastScan.of({ ...meta, run })
  }),
)
