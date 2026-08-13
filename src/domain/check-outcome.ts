import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type { CheckJob, CheckStatus } from "./check-result.js"
import { CheckResult, type CheckResult as CheckResultModel } from "./check-result.js"

export interface CheckOutcome {
  readonly status: CheckStatus
  readonly summary: string
  readonly details?: string | undefined
}

export const pass = (summary: string, details?: string): CheckOutcome => ({
  status: "pass",
  summary,
  details,
})

export const fail = (summary: string, details?: string): CheckOutcome => ({
  status: "fail",
  summary,
  details,
})

export const warn = (summary: string, details?: string): CheckOutcome => ({
  status: "warn",
  summary,
  details,
})

export const skipped = (summary: string): CheckOutcome => ({
  status: "skipped",
  summary,
})

export const instrument =
  (meta: { readonly id: string; readonly job: CheckJob; readonly name: string }) =>
  (effect: Effect.Effect<CheckOutcome>): Effect.Effect<CheckResultModel> =>
    Effect.timed(effect).pipe(
      Effect.map(([duration, outcome]) =>
        CheckResult.make({
          id: meta.id,
          job: meta.job,
          name: meta.name,
          status: outcome.status,
          summary: outcome.summary,
          durationMs: Duration.toMillis(duration),
          ...(outcome.details === undefined ? {} : { details: outcome.details }),
        }),
      ),
    )
