# AGENTS.md — CI Quality Gate Bot

## Mission
Build a GitHub Actions-triggered bot that runs on every push to `main` and every PR. It runs up to 18 deterministic quality checks plus an AI code review step, and reports results as a PR comment / check run. Stack: Effect-TS v4, Bun, Biome, TypeScript.

## Conventions (non-negotiable)
- `Context.Service`, not `Context.Tag`.
- Modular imports only: `import * as Effect from "effect/Effect"`. Never `import { X } from "effect"` (barrel imports). This is enforced as one of the checks below (Check 17), so the codebase you generate must also follow it.
- Explicit layer composition in `main.ts`. No scattered `Layer.provide` calls elsewhere.
- Bun runtime, Biome for lint/format (not ESLint/Prettier).
- `Effect.catchTag` at service boundaries. No broad `Effect.catchAll` swallowing errors — if you must, tag why in a comment.
- Build one service at a time. Confirm each before moving to the next. Do not generate the whole codebase in one shot.

## Architecture
Each check is a `Context.Service`. A `main.ts` composes them via explicit `Layer.provide` chains and runs them concurrently where possible (`Effect.all` with `{ concurrency: "unbounded" }` for independent checks), sequentially where one depends on another's output (e.g. build must succeed before bundle-size check).

Suggested service boundaries:
- `GitDiff` — resolves changed files for the PR/push (already exists in this repo)
- `CheckRunner` — generic interface all 18 checks implement: `run: Effect<CheckResult, CheckError>`
- Individual check services (grouped below) — each wraps a shell command or file inspection, parses output into a typed `CheckResult`
- `AiReviewer` — calls Groq (see below)
- `GithubReporter` — posts PR comment + sets check-run status via octokit/REST using `GITHUB_TOKEN`

`CheckResult` shape (suggested):
```ts
interface CheckResult {
  readonly name: string
  readonly status: "pass" | "fail" | "warn" | "skipped"
  readonly summary: string
  readonly details?: string
  readonly durationMs: number
}
```

## The 18 Checks

Group into 3 parallel jobs at the workflow level. Within each job, run checks concurrently via `Effect.all`.

**Job 1 — Static (fast, ~10-30s, blocks immediately)**
1. `tsc --noEmit` strict type check
2. Biome lint
3. Biome format check (`--check`, never auto-write in CI)
4. Circular dependency check (`madge --circular`)
5. No `console.log`/`debugger` left in non-script files
17. Grep-based house-rule check: fail if any `import { ... } from "effect"` barrel import appears
18. Grep-based check for bare `.pipe(Effect.catchAll` patterns swallowing errors too broadly

**Job 2 — Tests (parallel to Job 1)**
10. Unit tests (`bun test`)
11. Coverage threshold gate (fail if below configured floor, e.g. 80%)
12. Integration tests (only if `RUN_INTEGRATION=true` — gate behind env var since these hit real infra)

**Job 3 — Dependency, build, security (parallel, can be slower/async, only blocks on high severity)**
6. `bun audit`
7. Lockfile-in-sync check (`bun.lockb` matches `package.json`)
8. License compliance scan (skip if not OSS/client-facing — make this configurable via a flag in the workflow, default off)
9. Unused deps/exports (`knip`)
13. Production build succeeds (`bun build` / `tsc -p tsconfig.build.json`)
14. Bundle size check (skip — pure backend/CLI, no client bundle — implement as a no-op check that always passes with `skipped` status, don't omit the ID so numbering stays stable)
15. Secret scanning (gitleaks)
16. SAST (Semgrep, TS ruleset)

**AI step (separate job, runs after Job 1 passes — no point burning API calls on code that doesn't even type-check)**
- `AiReviewer` service calls Groq API on the diff
- Posts findings as part of the same PR comment, clearly separated from the deterministic check results (label section "AI Review (advisory, non-blocking)")
- AI findings should NOT fail the check run by default — they're advisory. Only deterministic checks (1-18) gate merge. Make this a config flag (`AI_REVIEW_BLOCKING=false` default) in case that policy changes later.

## Groq Integration
- Free tier, OpenAI-compatible API. Use `https://api.groq.com/openai/v1/chat/completions`.
- Fast models to use: `llama-3.3-70b-versatile` for review quality, or `llama-3.1-8b-instant` if you want to prioritize speed/rate-limit headroom over depth. Start with 70b, drop to 8b if you hit rate limits on busy repos.
- Auth: `Authorization: Bearer $GROQ_API_KEY` header, key from repo secret `GROQ_API_KEY`.
- `AiReviewer` service should:
  - Take the unified diff from `GitDiff`
  - Chunk if diff exceeds context window (Groq's context varies by model — check current limits, don't hardcode an assumption)
  - Prompt for structured JSON output (bug risk, severity, file/line, one-line reasoning) — do NOT let the model free-write prose, you need to parse this into `CheckResult`-like entries
  - Wrap the HTTP call in `Effect.tryPromise`, tag errors distinctly (`GroqRateLimitError`, `GroqApiError`, `GroqParseError`) so `GithubReporter` can degrade gracefully (post deterministic results even if AI step fails — never let AI failure block the whole report)
  - Respect Groq free-tier rate limits — add retry with backoff (`Effect.retry` with a `Schedule.exponential`), and a circuit-breaker-ish skip if repeatedly rate-limited (report "AI review skipped: rate limited" rather than failing the whole run)

## Build Order
1. Folder scaffolding
2. `CheckRunner` interface + `CheckResult` schema
3. Job 1 static checks (services 1-5, 17-18)
4. Job 2 test checks (services 10-12)
5. Job 3 dependency/build/security checks (services 6-9, 13-16)
6. `AiReviewer` (Groq)
7. `GithubReporter` (octokit, PR comment + check-run status, formats deterministic results + AI section)
8. `main.ts` wiring — explicit layer composition, concurrency grouping per job
9. GitHub Actions workflow YAML — 3 parallel jobs + 1 dependent AI job, fail-fast on Job 1

## Non-goals for this pass
- No auto-fix behavior in CI (format/lint check only, never write)
- No blocking merge on AI findings by default
- No bundle-size enforcement (backend-only project)
