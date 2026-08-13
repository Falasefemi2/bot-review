import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandRunner, type CommandRunnerShape } from "../../app/command-runner.js"
import { instrument } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"
import { runCommand } from "../run-command.js"

const meta = { id: "7", job: "deps", name: "Lockfile in sync" } as const

export interface LockfileSyncShape extends CheckRunner {}
export class LockfileSync extends Context.Service<LockfileSync, LockfileSyncShape>()("@checks/deps/LockfileSync") {}

export const layer = Layer.effect(
  LockfileSync,
  Effect.gen(function* () {
    const runner: CommandRunnerShape = yield* CommandRunner
    const run = instrument(meta)(
      runCommand(
        runner,
        {
          command: "bun",
          args: ["install", "--frozen-lockfile"],
          timeoutMillis: 300_000,
        },
        {
          passSummary: "bun.lock is in sync with package.json",
          failSummary: "bun.lock is out of sync with package.json",
        },
      ),
    )
    return LockfileSync.of({ ...meta, run })
  }),
)
