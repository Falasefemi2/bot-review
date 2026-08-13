import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

export const CHECK_JOBS = ["static", "tests", "deps", "ai", "report"] as const
export type CheckJobName = (typeof CHECK_JOBS)[number]

export const CheckJobName = Schema.Literals(CHECK_JOBS)

export interface GitHubConfig {
  readonly owner: string
  readonly repo: string
  readonly token: Option.Option<Redacted.Redacted<string>>
  readonly eventName: string | undefined
  readonly eventPath: string | undefined
  readonly sha: string | undefined
  readonly refName: string | undefined
  readonly baseRef: string | undefined
  readonly headRef: string | undefined
  readonly prNumber: number | undefined
}

export interface GroqConfig {
  readonly apiKey: Option.Option<Redacted.Redacted<string>>
  readonly baseUrl: string
  readonly model: string
  readonly maxDiffChars: number
}

export interface GateConfig {
  readonly runIntegration: boolean
  readonly integrationTestPath: string
  readonly coverageThreshold: number
  readonly licenseScanEnabled: boolean
  readonly aiReviewBlocking: boolean
}

export interface AppConfigShape {
  readonly checkJob: CheckJobName
  readonly resultDir: string
  readonly github: GitHubConfig
  readonly groq: GroqConfig
  readonly gates: GateConfig
}

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()("@app/AppConfig") {}

const optionalString = (name: string) => Config.string(name).pipe(Config.option)

const optionalRedacted = (name: string) => Config.redacted(name).pipe(Config.option)

export const parsePrNumber = (refName: string | undefined): number | undefined => {
  if (refName === undefined) return undefined
  const match = /^(\d+)\/merge$/.exec(refName)
  return match === null ? undefined : Number(match[1])
}

const splitRepository = (repository: Option.Option<string>) =>
  Option.flatMap(repository, (value) => {
    const index = value.indexOf("/")
    if (index === -1) return Option.none()
    return Option.some({ owner: value.slice(0, index), repo: value.slice(index + 1) })
  })

export const layer = Layer.effect(
  AppConfig,
  Effect.gen(function* () {
    const [
      checkJob,
      resultDir,
      token,
      groqApiKey,
      eventName,
      eventPath,
      sha,
      refName,
      baseRef,
      headRef,
      repository,
      runIntegration,
      integrationTestPath,
      coverageThreshold,
      licenseScanEnabled,
      aiReviewBlocking,
      groqModel,
      groqBaseUrl,
      maxDiffChars,
    ] = yield* Effect.all([
      Config.schema(CheckJobName, "CHECK_JOB").pipe(Config.withDefault("static")),
      Config.string("RESULT_DIR").pipe(Config.withDefault("bot-results")),
      optionalRedacted("GITHUB_TOKEN"),
      optionalRedacted("GROQ_API_KEY"),
      optionalString("GITHUB_EVENT_NAME"),
      optionalString("GITHUB_EVENT_PATH"),
      optionalString("GITHUB_SHA"),
      optionalString("GITHUB_REF_NAME"),
      optionalString("GITHUB_BASE_REF"),
      optionalString("GITHUB_HEAD_REF"),
      optionalString("GITHUB_REPOSITORY"),
      Config.boolean("RUN_INTEGRATION").pipe(Config.withDefault(false)),
      Config.string("INTEGRATION_TEST_PATH").pipe(Config.withDefault("test/integration")),
      Config.number("COVERAGE_THRESHOLD").pipe(Config.withDefault(80)),
      Config.boolean("LICENSE_SCAN_ENABLED").pipe(Config.withDefault(false)),
      Config.boolean("AI_REVIEW_BLOCKING").pipe(Config.withDefault(false)),
      Config.string("GROQ_MODEL").pipe(Config.withDefault("llama-3.3-70b-versatile")),
      Config.string("GROQ_BASE_URL").pipe(Config.withDefault("https://api.groq.com/openai/v1")),
      Config.number("AI_MAX_DIFF_CHARS").pipe(Config.withDefault(20000)),
    ])

    const ownerRepo = Option.match(splitRepository(repository), {
      onNone: () => ({ owner: "<unknown>", repo: "<unknown>" }),
      onSome: (value) => value,
    })

    return AppConfig.of({
      checkJob,
      resultDir,
      github: {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        token,
        eventName: Option.getOrUndefined(eventName),
        eventPath: Option.getOrUndefined(eventPath),
        sha: Option.getOrUndefined(sha),
        refName: Option.getOrUndefined(refName),
        baseRef: Option.getOrUndefined(baseRef),
        headRef: Option.getOrUndefined(headRef),
        prNumber: parsePrNumber(Option.getOrUndefined(refName)),
      },
      groq: {
        apiKey: groqApiKey,
        baseUrl: groqBaseUrl,
        model: groqModel,
        maxDiffChars,
      },
      gates: {
        runIntegration,
        integrationTestPath,
        coverageThreshold,
        licenseScanEnabled,
        aiReviewBlocking,
      },
    })
  }),
)
