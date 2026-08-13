import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "10", job: "tests", name: "Unit tests" } as const

export interface UnitTestsShape extends CheckRunner {}
export class UnitTests extends Context.Service<UnitTests, UnitTestsShape>()("@checks/tests/UnitTests") {}

export const layer = Layer.effect(
  UnitTests,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        { command: "bun", args: ["test"], timeoutMillis: 600_000, env: { BOT_REVIEW_NESTED: "1" } },
        { passSummary: "bun test passed", failSummary: "bun test failed" },
      ),
    )
    return UnitTests.of({ ...meta, run })
  }),
)
