import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "3", job: "static", name: "Biome format" } as const

export interface BiomeFormatShape extends CheckRunner {}
export class BiomeFormat extends Context.Service<BiomeFormat, BiomeFormatShape>()("@checks/static/BiomeFormat") {}

export const layer = Layer.effect(
  BiomeFormat,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        { command: "biome", args: ["format", "."] },
        { passSummary: "biome format reported no changes needed", failSummary: "biome format would change files" },
      ),
    )
    return BiomeFormat.of({ ...meta, run })
  }),
)
