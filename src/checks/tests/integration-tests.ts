import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { AppConfig, type AppConfigShape } from "../../app/app-config.js"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument, skipped } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "12", job: "tests", name: "Integration tests" } as const

export interface IntegrationTestsShape extends CheckRunner {}
export class IntegrationTests extends Context.Service<IntegrationTests, IntegrationTestsShape>()(
  "@checks/tests/IntegrationTests",
) {}

export const layer = Layer.effect(
  IntegrationTests,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const config: AppConfigShape = yield* AppConfig

    const run = instrument(meta)(
      Effect.suspend(() => {
        if (!config.gates.runIntegration) {
          return Effect.succeed(skipped("Integration tests disabled (RUN_INTEGRATION=false)"))
        }
        return runCommand(
          runner,
          { command: "bun", args: ["test", config.gates.integrationTestPath], timeoutMillis: 600_000 },
          { passSummary: "Integration tests passed", failSummary: "Integration tests failed" },
        )
      }),
    )

    return IntegrationTests.of({ ...meta, run })
  }),
)
