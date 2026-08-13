import * as Effect from "effect/Effect"
import type { CommandRequest, CommandRunnerShape } from "../app/command-runner.js"
import { outcomeFromExitCode, outcomeToolMissing } from "./command-outcome.js"

const COMMAND_ERROR_TAG = "@app/CommandRunner.CommandError"

export const runCommand = (
  runner: CommandRunnerShape,
  request: CommandRequest,
  options: { readonly passSummary: string; readonly failSummary: string },
): Effect.Effect<ReturnType<typeof outcomeFromExitCode>> =>
  runner.run(request).pipe(
    Effect.map((result) => outcomeFromExitCode(result, options)),
    Effect.catchTag(COMMAND_ERROR_TAG, (error) => Effect.succeed(outcomeToolMissing(request.command, error.message))),
  )
