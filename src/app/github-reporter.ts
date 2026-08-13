import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { AppConfig, type AppConfigShape } from "../app/app-config.js"
import type { AIFinding } from "../domain/ai-review.js"
import type { CheckJob, CheckResult, CheckStatus } from "../domain/check-result.js"

export interface ReportInput {
  readonly results: readonly CheckResult[]
  readonly aiFindings: readonly AIFinding[]
  readonly aiNote?: string | undefined
}

export interface ReportOutcome {
  readonly commentUrl: string | undefined
  readonly checkRunId: number | undefined
  readonly skipped: boolean
}

export interface GithubReporterShape {
  readonly report: (input: ReportInput) => Effect.Effect<ReportOutcome, GithubReportError>
}

export class GithubReportError extends Schema.TaggedError<GithubReportError>()(
  "@app/GithubReporter.GithubReportError",
  {
    code: Schema.Union([Schema.Literals(["missingConfig", "api", "parse"])]),
    message: Schema.String,
  },
) {}

export class GithubReporter extends Context.Service<GithubReporter, GithubReporterShape>()("@app/GithubReporter") {}

const GITHUB_API = "https://api.github.com"

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: "✅",
  fail: "❌",
  warn: "⚠️",
  skipped: "⏭️",
}

const JOB_ORDER: readonly CheckJob[] = ["static", "tests", "deps"]

const JOB_LABEL: Record<CheckJob, string> = {
  static: "Static analysis",
  tests: "Tests",
  deps: "Dependencies, build & security",
}

const formatResult = (result: CheckResult): string => {
  const icon = STATUS_ICON[result.status]
  const line = `${icon} **${result.id}. ${result.name}** — ${result.summary} (${result.durationMs}ms)`
  if (result.details === undefined || result.details.length === 0) return line
  const details = result.details.length > 2000 ? `${result.details.slice(0, 2000)}…` : result.details
  return `${line}\n\n<details><summary>Details</summary>\n\n\`\`\`text\n${details}\n\`\`\`\n\n</details>`
}

const formatAiFindings = (input: ReportInput): string => {
  const lines = ["### AI Review (advisory, non-blocking)"]
  if (input.aiFindings.length === 0) {
    const note = input.aiNote ?? "No issues found."
    lines.push("", note)
    return lines.join("\n")
  }
  lines.push(
    "",
    ...input.aiFindings.map((finding) => {
      const location = `${finding.file}${finding.line === undefined ? "" : `:${finding.line}`}`
      return `- **[${finding.severity.toUpperCase()}]** \`${location}\` — ${finding.title}: ${finding.reasoning}`
    }),
  )
  if (input.aiNote !== undefined) lines.push("", input.aiNote)
  return lines.join("\n")
}

export const buildCommentBody = (input: ReportInput): string => {
  const sections = JOB_ORDER.map((job) => {
    const results = input.results.filter((result) => result.job === job)
    if (results.length === 0) return undefined
    const header = `### ${JOB_LABEL[job]}`
    const lines = results.map(formatResult)
    return [header, "", ...lines].join("\n")
  }).filter((section): section is string => section !== undefined)

  return ["## CI Quality Gate", "", ...sections, "", formatAiFindings(input)].join("\n")
}

const statusCounts = (results: readonly CheckResult[]): Record<CheckStatus, number> => {
  const counts: Record<CheckStatus, number> = { pass: 0, fail: 0, warn: 0, skipped: 0 }
  for (const result of results) {
    counts[result.status] = counts[result.status] + 1
  }
  return counts
}

export const computeConclusion = (
  results: readonly CheckResult[],
  aiFindings: readonly AIFinding[],
  aiReviewBlocking: boolean,
): "success" | "failure" | "neutral" => {
  const counts = statusCounts(results)
  if (counts.fail > 0) return "failure"
  if (aiReviewBlocking && aiFindings.some((finding) => finding.severity === "high")) return "failure"
  if (counts.warn > 0) return "neutral"
  return "success"
}

const getToken = (config: AppConfigShape): Redacted.Redacted<string> | undefined =>
  Option.getOrUndefined(config.github.token)

const getRepo = (config: AppConfigShape): string | undefined =>
  config.github.owner === "<unknown>" || config.github.repo === "<unknown>" ? undefined : config.github.repo

const buildRequest = (
  config: AppConfigShape,
  path: string,
  body: unknown,
): Effect.Effect<HttpClientRequest.HttpClientRequest, GithubReportError> => {
  const token = getToken(config)
  const repo = getRepo(config)
  if (token === undefined) {
    return Effect.fail(new GithubReportError({ code: "missingConfig", message: "GITHUB_TOKEN is not set" }))
  }
  if (repo === undefined) {
    return Effect.fail(new GithubReportError({ code: "missingConfig", message: "GITHUB_REPOSITORY is not set" }))
  }
  return HttpBody.json(body).pipe(
    Effect.map((payload) =>
      HttpClientRequest.post(`${GITHUB_API}/repos/${config.github.owner}/${repo}${path}`).pipe(
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${Redacted.value(token)}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        }),
        HttpClientRequest.setBody(payload),
        HttpClientRequest.acceptJson,
      ),
    ),
    Effect.mapError(() => new GithubReportError({ code: "parse", message: "Could not encode request body" })),
  )
}

const execute = (
  http: HttpClient.HttpClient,
  request: Effect.Effect<HttpClientRequest.HttpClientRequest, GithubReportError>,
): Effect.Effect<unknown, GithubReportError> =>
  request.pipe(
    Effect.flatMap((req) => http.execute(req)),
    Effect.mapError((error) => new GithubReportError({ code: "api", message: error.message })),
    Effect.flatMap((response) =>
      HttpClientResponse.filterStatusOk(response).pipe(
        Effect.mapError((error) => new GithubReportError({ code: "api", message: error.message })),
        Effect.flatMap(() =>
          response.json.pipe(
            Effect.mapError(() => new GithubReportError({ code: "parse", message: "Response was not JSON" })),
          ),
        ),
      ),
    ),
  )

const postComment = (
  http: HttpClient.HttpClient,
  config: AppConfigShape,
  body: string,
): Effect.Effect<string, GithubReportError> => {
  const prNumber = config.github.prNumber
  if (prNumber === undefined) {
    return Effect.fail(new GithubReportError({ code: "missingConfig", message: "No pull request number" }))
  }
  const CommentResponse = Schema.Struct({ html_url: Schema.String })
  return execute(http, buildRequest(config, `/issues/${prNumber}/comments`, { body })).pipe(
    Effect.flatMap((data) =>
      Schema.decodeUnknownEffect(CommentResponse)(data).pipe(
        Effect.map((parsed) => parsed.html_url),
        Effect.mapError(() => new GithubReportError({ code: "parse", message: "Unexpected comment response shape" })),
      ),
    ),
  )
}

const createCheckRun = (
  http: HttpClient.HttpClient,
  config: AppConfigShape,
  input: ReportInput,
  conclusion: "success" | "failure" | "neutral",
): Effect.Effect<number, GithubReportError> => {
  const sha = config.github.sha
  if (sha === undefined) {
    return Effect.fail(new GithubReportError({ code: "missingConfig", message: "No GITHUB_SHA" }))
  }
  const counts = statusCounts(input.results)
  const summary =
    `Checks: ${counts.pass} passed, ${counts.fail} failed, ${counts.warn} warned, ${counts.skipped} skipped.` +
    (input.aiFindings.length > 0 ? ` AI review: ${input.aiFindings.length} finding(s).` : "")
  const CheckRunResponse = Schema.Struct({ id: Schema.Number })
  return execute(
    http,
    buildRequest(config, "/check-runs", {
      name: "bot-review",
      head_sha: sha,
      status: "completed",
      conclusion,
      output: {
        title: "CI Quality Gate",
        summary,
        text: buildCommentBody(input),
      },
    }),
  ).pipe(
    Effect.flatMap((data) =>
      Schema.decodeUnknownEffect(CheckRunResponse)(data).pipe(
        Effect.map((parsed) => parsed.id),
        Effect.mapError(() => new GithubReportError({ code: "parse", message: "Unexpected check-run response shape" })),
      ),
    ),
  )
}

const GITHUB_REPORT_ERROR_TAG = "@app/GithubReporter.GithubReportError"

export const layer = Layer.effect(
  GithubReporter,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const config: AppConfigShape = yield* AppConfig
    const report = Effect.fn("GithubReporter.report")((input: ReportInput) =>
      Effect.gen(function* () {
        const conclusion = computeConclusion(input.results, input.aiFindings, config.gates.aiReviewBlocking)

        // The report step must never fail the whole run: a missing token, a bad
        // repository context, or a GitHub API outage should degrade to a logged
        // skip so deterministic results still surface in logs / result files.
        const checkRunId = yield* createCheckRun(http, config, input, conclusion).pipe(
          Effect.tapError((error) => Effect.logWarning("GithubReporter.check_run_skipped", error)),
          Effect.catchTag(GITHUB_REPORT_ERROR_TAG, () => Effect.succeed(undefined as number | undefined)),
        )

        const commentUrl = yield* postComment(http, config, buildCommentBody(input)).pipe(
          Effect.tapError((error) => Effect.logWarning("GithubReporter.comment_skipped", error)),
          Effect.catchTag(GITHUB_REPORT_ERROR_TAG, () => Effect.succeed(undefined as string | undefined)),
        )

        const skipped = checkRunId === undefined && commentUrl === undefined
        return { commentUrl, checkRunId, skipped }
      }),
    )
    return GithubReporter.of({ report })
  }),
)
