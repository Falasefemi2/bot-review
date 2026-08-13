import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "4", job: "static", name: "Circular dependencies" } as const

export interface CircularDepsShape extends CheckRunner {}
export class CircularDeps extends Context.Service<CircularDeps, CircularDepsShape>()("@checks/static/CircularDeps") {}

export const layer = Layer.effect(
  CircularDeps,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        {
          command: "bunx",
          args: ["madge", "--circular", "--extensions", "ts,tsx", "src"],
          timeoutMillis: 300_000,
        },
        { passSummary: "madge found no circular dependencies", failSummary: "madge found circular dependencies" },
      ),
    )
    return CircularDeps.of({ ...meta, run })
  }),
)
