import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "1", job: "static", name: "TypeScript type check" } as const

export interface TypecheckShape extends CheckRunner {}
export class Typecheck extends Context.Service<Typecheck, TypecheckShape>()("@checks/static/Typecheck") {}

export const layer = Layer.effect(
  Typecheck,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        { command: "bunx", args: ["tsc", "--noEmit"], timeoutMillis: 300_000 },
        { passSummary: "tsc --noEmit passed", failSummary: "tsc --noEmit reported type errors" },
      ),
    )
    return Typecheck.of({ ...meta, run })
  }),
)
