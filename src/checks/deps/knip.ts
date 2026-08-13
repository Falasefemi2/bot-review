import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "9", job: "deps", name: "Unused dependencies and exports" } as const

export interface KnipShape extends CheckRunner {}
export class Knip extends Context.Service<Knip, KnipShape>()("@checks/deps/Knip") {}

export const layer = Layer.effect(
  Knip,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        { command: "bunx", args: ["knip"], timeoutMillis: 300_000 },
        {
          passSummary: "knip found no unused dependencies or exports",
          failSummary: "knip found unused dependencies or exports",
        },
      ),
    )
    return Knip.of({ ...meta, run })
  }),
)
