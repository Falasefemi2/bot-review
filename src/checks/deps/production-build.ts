import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "13", job: "deps", name: "Production build" } as const

export interface ProductionBuildShape extends CheckRunner {}
export class ProductionBuild extends Context.Service<ProductionBuild, ProductionBuildShape>()(
  "@checks/deps/ProductionBuild",
) {}

export const layer = Layer.effect(
  ProductionBuild,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        { command: "bunx", args: ["tsc", "-p", "tsconfig.build.json"], timeoutMillis: 300_000 },
        { passSummary: "Production build succeeded", failSummary: "Production build failed" },
      ),
    )
    return ProductionBuild.of({ ...meta, run })
  }),
)
