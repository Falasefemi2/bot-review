import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as PlatformError from "effect/PlatformError"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { type ChildProcessHandle, ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

export interface CommandRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string | undefined
  readonly env?: Record<string, string> | undefined
  readonly timeoutMillis?: number | undefined
}

export interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface CommandRunnerShape {
  readonly run: (request: CommandRequest) => Effect.Effect<CommandResult, CommandError>
}

export class CommandError extends Schema.TaggedError<CommandError>()("@app/CommandRunner.CommandError", {
  command: Schema.String,
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
}) {}

export class CommandRunner extends Context.Service<CommandRunner, CommandRunnerShape>()("@app/CommandRunner") {}

export interface Spawner {
  readonly spawn: (
    command: ChildProcess.Command,
  ) => Effect.Effect<ChildProcessHandle, PlatformError.PlatformError, Scope.Scope>
}

const DEFAULT_TIMEOUT_MILLIS = 300_000

const describePlatformError = (
  cause: PlatformError.PlatformError,
): { readonly message: string; readonly code: string | undefined } => {
  const reason = cause.reason
  if (reason._tag === "BadArgument") {
    const message = `${reason.method}: ${reason.description ?? ""}`.trim()
    return { message: message.length === 0 ? "invalid command" : message, code: undefined }
  }
  const raw = reason.cause
  const rawCode =
    raw !== null && typeof raw === "object" && "code" in raw && typeof raw.code === "string" ? raw.code : undefined
  return { message: `${reason.method}: ${reason.message}`, code: rawCode ?? reason._tag }
}

const toCommandError =
  (request: CommandRequest) =>
  (cause: PlatformError.PlatformError): CommandError => {
    const { message, code } = describePlatformError(cause)
    return new CommandError({
      command: request.command,
      message,
      ...(code === undefined ? {} : { code }),
    })
  }

const readStream = (request: CommandRequest) => (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
  stream.pipe(
    Stream.decodeText({ encoding: "utf-8" }),
    Stream.runCollect,
    Effect.map((chunks) => chunks.join("")),
    Effect.mapError(toCommandError(request)),
  )

const runWithSpawner = (spawner: Spawner, request: CommandRequest) => {
  const timeoutMillis = request.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS

  const scoped = Effect.scoped(
    Effect.gen(function* () {
      const command = ChildProcess.make(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        stdout: "pipe",
        stderr: "pipe",
      })

      const handle = yield* spawner.spawn(command).pipe(Effect.mapError(toCommandError(request)))

      const read = readStream(request)

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          read(handle.stdout),
          read(handle.stderr),
          handle.exitCode.pipe(Effect.mapError(toCommandError(request))),
        ] as const,
        { concurrency: "unbounded" },
      )

      return { exitCode: Number(exitCode), stdout, stderr }
    }),
  )

  return Effect.catchTag(Effect.timeout(scoped, Duration.millis(timeoutMillis)), "TimeoutError", () =>
    Effect.fail(new CommandError({ command: request.command, message: `command timed out after ${timeoutMillis}ms` })),
  )
}

export const layer = Layer.effect(
  CommandRunner,
  Effect.gen(function* () {
    const spawner: Spawner = yield* ChildProcessSpawner
    const run = Effect.fn("CommandRunner.run")((request: CommandRequest) => runWithSpawner(spawner, request))
    return CommandRunner.of({ run })
  }),
)
