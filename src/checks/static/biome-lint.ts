import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "2", job: "static", name: "Biome lint" } as const

export interface BiomeLintShape extends CheckRunner {}
export class BiomeLint extends Context.Service<BiomeLint, BiomeLintShape>()("@checks/static/BiomeLint") {}

export const layer = Layer.effect(
  BiomeLint,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        { command: "biome", args: ["lint", "."] },
        { passSummary: "biome lint reported no issues", failSummary: "biome lint found issues" },
      ),
    )
    return BiomeLint.of({ ...meta, run })
  }),
)
