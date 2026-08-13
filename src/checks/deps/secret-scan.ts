import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "15", job: "deps", name: "Secret scanning" } as const

export interface SecretScanShape extends CheckRunner {}
export class SecretScan extends Context.Service<SecretScan, SecretScanShape>()("@checks/deps/SecretScan") {}

export const layer = Layer.effect(
  SecretScan,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        {
          command: "gitleaks",
          args: ["detect", "--source", ".", "--no-banner", "--redact"],
          timeoutMillis: 300_000,
        },
        { passSummary: "gitleaks found no secrets", failSummary: "gitleaks found potential secrets" },
      ),
    )
    return SecretScan.of({ ...meta, run })
  }),
)
