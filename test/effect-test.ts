import { test } from "bun:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Layer from "effect/Layer"

export const effectTests = <R>(provided: Layer.Layer<R, never>) => {
  const run = <A, E>(effect: Effect.Effect<A, E, R>) => Effect.runPromiseExit(Effect.provide(effect, provided))

  return {
    test: <A, E>(name: string, self: () => Effect.Effect<A, E, R>, timeoutMs = 120_000) =>
      test(
        name,
        async () => {
          const exit = await run(self())
          if (Exit.isFailure(exit)) {
            throw new Error(Cause.pretty(exit.cause))
          }
        },
        { timeout: timeoutMs },
      ),
    run,
  }
}
