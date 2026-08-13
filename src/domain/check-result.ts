import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export const CheckStatus = Schema.Literals(["pass", "fail", "warn", "skipped"])
export type CheckStatus = Schema.Schema.Type<typeof CheckStatus>

export const CheckJob = Schema.Literals(["static", "tests", "deps"])
export type CheckJob = Schema.Schema.Type<typeof CheckJob>

export const CheckResult = Schema.Struct({
  id: Schema.String,
  job: CheckJob,
  name: Schema.String,
  status: CheckStatus,
  summary: Schema.String,
  details: Schema.optionalKey(Schema.String),
  durationMs: Schema.Number,
})

export interface CheckResult extends Schema.Schema.Type<typeof CheckResult> {}

export class CheckError extends Schema.TaggedError<CheckError>()("@app/CheckRunner.CheckError", {
  checkId: Schema.String,
  message: Schema.String,
}) {}

export interface CheckRunner {
  readonly id: string
  readonly job: CheckJob
  readonly name: string
  readonly run: Effect.Effect<CheckResult, CheckError>
}
