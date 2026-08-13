import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "6", job: "deps", name: "Dependency audit" } as const

export interface BunAuditShape extends CheckRunner {}
export class BunAudit extends Context.Service<BunAudit, BunAuditShape>()("@checks/deps/BunAudit") {}

export const layer = Layer.effect(
  BunAudit,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        { command: "bun", args: ["audit"], timeoutMillis: 300_000 },
        { passSummary: "bun audit found no vulnerabilities", failSummary: "bun audit found vulnerabilities" },
      ),
    )
    return BunAudit.of({ ...meta, run })
  }),
)
