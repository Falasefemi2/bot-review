import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { AppConfig, type AppConfigShape } from "../app/app-config.js"
import { type DiffContext, GitDiff, type GitDiffShape } from "../app/git-diff.js"
import type { AIFinding, AISeverity } from "../domain/ai-review.js"

export interface AiReviewShape {
  readonly review: () => Effect.Effect<readonly AIFinding[], AiReviewError>
}

export class AiReviewError extends Schema.TaggedError<AiReviewError>()("@app/AiReviewer.AiReviewError", {
  code: Schema.Union([Schema.Literals(["missingConfig", "rateLimit", "api", "parse"])]),
  message: Schema.String,
}) {}

export class AiReviewer extends Context.Service<AiReviewer, AiReviewShape>()("@app/AiReviewer") {}

const OpenAIResponse = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.String,
      }),
    }),
  ),
})

const FindingsSchema = Schema.Array(
  Schema.Struct({
    file: Schema.String,
    line: Schema.optionalKey(Schema.Number),
    severity: Schema.Literals(["low", "medium", "high"]),
    title: Schema.String,
    reasoning: Schema.String,
  }),
)

const buildPrompt = (diff: string): string =>
  `You are a senior code reviewer. Review the following git diff for bugs, security issues, and correctness problems.

Return ONLY valid JSON: an array of objects with fields:
- "file": string (the file path)
- "line": number|null (approximate line in the file, or null)
- "severity": "low" | "medium" | "high"
- "title": string (short, e.g. "Null dereference possible")
- "reasoning": string (one sentence of reasoning)

If there are no issues, return [].

DIFF:
${diff}`

const chunkDiff = (diff: string, maxChars: number): readonly string[] => {
  if (diff.length <= maxChars) return [diff]
  const chunks: string[] = []
  let remaining = diff
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxChars))
    remaining = remaining.slice(maxChars)
  }
  return chunks
}

const callGroq = (
  http: HttpClient.HttpClient,
  config: AppConfigShape,
  prompt: string,
): Effect.Effect<string, AiReviewError> => {
  const apiKey = Option.getOrUndefined(config.groq.apiKey)
  if (apiKey === undefined) {
    return Effect.fail(new AiReviewError({ code: "missingConfig", message: "GROQ_API_KEY is not set" }))
  }

  const request = HttpBody.json({
    model: config.groq.model,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  }).pipe(
    Effect.map((body) =>
      HttpClientRequest.post(`${config.groq.baseUrl.replace(/\/$/, "")}/chat/completions`).pipe(
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${Redacted.value(apiKey)}`,
          "Content-Type": "application/json",
        }),
        HttpClientRequest.setBody(body),
      ),
    ),
  )

  return request.pipe(
    Effect.flatMap((req) => http.execute(req)),
    Effect.mapError((error) => toAiReviewError(error)),
    Effect.flatMap((response) =>
      response.json.pipe(
        Effect.mapError(() => new AiReviewError({ code: "parse", message: "Groq response was not JSON" })),
      ),
    ),
    Effect.flatMap((data) =>
      Schema.decodeUnknownEffect(OpenAIResponse)(data).pipe(
        Effect.map((parsed) => parsed.choices[0]?.message.content ?? ""),
        Effect.mapError(() => new AiReviewError({ code: "parse", message: "Unexpected Groq response shape" })),
      ),
    ),
  )
}

const extractStatus = (error: Record<string, unknown>): number | undefined => {
  const response = error.response
  if (response !== null && typeof response === "object" && "status" in response) {
    const status = (response as { status: unknown }).status
    if (typeof status === "number") return status
  }
  return undefined
}

const extractMessage = (error: Record<string, unknown>): string | undefined => {
  for (const key of ["description", "message", "reason"] as const) {
    const value = error[key]
    if (typeof value === "string") return value
  }
  return undefined
}

const toAiReviewError = (error: unknown): AiReviewError => {
  const errorObj = error !== null && typeof error === "object" ? (error as Record<string, unknown>) : {}
  const status = extractStatus(errorObj)
  const message = extractMessage(errorObj) ?? "Unknown Groq API error"

  if (status === 429) {
    return new AiReviewError({ code: "rateLimit", message: "Groq API rate limited" })
  }
  if (status !== undefined) {
    return new AiReviewError({ code: "api", message: `Groq API error (HTTP ${status}): ${message}` })
  }
  return new AiReviewError({ code: "api", message: `Groq network error: ${message}` })
}

const withRetry = (effect: Effect.Effect<string, AiReviewError>) =>
  Effect.retry(
    effect.pipe(
      Effect.filterOrFail(
        (content) => content.length > 0,
        () => new AiReviewError({ code: "parse", message: "Groq returned an empty response" }),
      ),
    ),
    Schedule.max([Schedule.exponential("500 millis"), Schedule.recurs(3)]),
  )

const parseFindings = (content: string): Effect.Effect<readonly AIFinding[], AiReviewError> => {
  try {
    const jsonText = content.replace(/```json|```/g, "").trim()
    const parsed: unknown = JSON.parse(jsonText)
    return Schema.decodeUnknownEffect(FindingsSchema)(parsed).pipe(
      Effect.map((items) =>
        items.map((item) => ({
          file: item.file,
          line: item.line === undefined ? undefined : item.line,
          severity: item.severity as AISeverity,
          title: item.title,
          reasoning: item.reasoning,
        })),
      ),
      Effect.mapError(() => new AiReviewError({ code: "parse", message: "Could not parse AI findings JSON" })),
    )
  } catch {
    return Effect.fail(new AiReviewError({ code: "parse", message: "Could not parse AI findings JSON" }))
  }
}

const reviewDiff = (
  http: HttpClient.HttpClient,
  config: AppConfigShape,
  diff: DiffContext,
): Effect.Effect<readonly AIFinding[], AiReviewError> => {
  if (diff.unifiedDiff.trim().length === 0) {
    return Effect.succeed([])
  }
  const chunks = chunkDiff(diff.unifiedDiff, config.groq.maxDiffChars)
  return Effect.all(
    chunks.map((chunk) =>
      withRetry(callGroq(http, config, buildPrompt(chunk))).pipe(
        Effect.flatMap(parseFindings),
        Effect.catchIf(
          (e): e is AiReviewError => e.code === "rateLimit",
          () => Effect.succeed([] as readonly AIFinding[]),
        ),
      ),
    ),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((findings) => findings.flat()))
}

export const layer = Layer.effect(
  AiReviewer,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const gitDiff: GitDiffShape = yield* GitDiff
    const config: AppConfigShape = yield* AppConfig
    const review = Effect.fn("AiReviewer.review")(() =>
      gitDiff.resolve().pipe(
        Effect.flatMap((diff) => reviewDiff(http, config, diff)),
        Effect.mapError(() => new AiReviewError({ code: "api", message: "Could not resolve diff" })),
      ),
    )
    return AiReviewer.of({ review })
  }),
)
