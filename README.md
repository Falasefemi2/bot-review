# bot-review

A CI quality gate bot for GitHub. It runs up to 18 deterministic checks plus an
advisory AI code review on every push to `main` and every pull request, then
posts the results as a check run and a PR comment.

Stack: Effect-TS v4, Bun, Biome, TypeScript.

## How it works

A GitHub Actions workflow splits the checks into jobs that run in parallel:

| Job | Checks | Notes |
| --- | ------ | ----- |
| static | TypeScript, Biome lint/format, circular deps, grep house rules | Fails fast; blocks immediately |
| tests | Unit tests, coverage gate, integration tests | Coverage gate defaults to 80% |
| deps | `bun audit`, lockfile sync, license scan, knip, production build, bundle size, gitleaks, Semgrep | Security tools are advisory warnings, not blockers |
| ai | Groq API review of the diff | Advisory and non-blocking by default |
| report | Aggregates results, posts check run + PR comment | Always runs, even when a check fails |

Each check produces a structured result with a `pass`, `fail`, `warn`, or
`skipped` status. Only deterministic checks (1-18) gate merge. AI findings are
advisory and clearly separated in the PR comment.

## Requirements

- Bun (runtime)
- Node.js / TypeScript toolchain the checks invoke: `tsc`, `biome`, `knip`,
  `madge`, `bun test`
- A GitHub repo with Actions enabled

## Local setup

Copy the example environment file and fill in what you need:

```bash
cp .env.example .env
```

The `.env` file is gitignored. It is only used for local runs; GitHub Actions
injects its own `GITHUB_*` variables automatically, so you do not need a token
in `.env` for CI.

### Running locally

Install dependencies:

```bash
bun install
```

Run a single job group:

```bash
CHECK_JOB=static RESULT_DIR=bot-results bun run src/main.ts
```

Valid values for `CHECK_JOB` are `static`, `tests`, `deps`, `ai`, and `report`.
Each job writes its results to `RESULT_DIR` (e.g. `static.json`, `tests.json`).
Run the jobs in order, then run `report` to see the aggregated output.

Useful commands:

```bash
bun run check    # tsc --noEmit
bun run lint     # biome check src test
bun run format   # biome format --write src test
bun test         # unit tests
bun run build    # tsc -p tsconfig.build.json
```

### Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `CHECK_JOB` | `static` | Which job group to run |
| `RESULT_DIR` | `bot-results` | Where check results are written |
| `GITHUB_TOKEN` | - | GitHub token for posting results (CI injects it) |
| `GITHUB_REPOSITORY` | - | `owner/repo` (CI injects it) |
| `GITHUB_SHA` | - | Commit SHA (CI injects it) |
| `GROQ_API_KEY` | - | API key for the AI review step |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model for AI review |
| `AI_MAX_DIFF_CHARS` | `20000` | Chunk the diff beyond this size |
| `COVERAGE_THRESHOLD` | `80` | Minimum line coverage percentage |
| `RUN_INTEGRATION` | `false` | Whether to run integration tests |
| `LICENSE_SCAN_ENABLED` | `false` | Whether to run the license scan |
| `AI_REVIEW_BLOCKING` | `false` | Whether AI findings can fail the run |

## Using it in another project

The project ships a reusable GitHub Actions workflow
(`.github/workflows/reusable-quality-gates.yml`). Point another repo at it with
a thin wrapper workflow:

```yaml
name: Quality Gate
on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    uses: <owner>/bot-review/.github/workflows/reusable-quality-gates.yml@main
    secrets:
      GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}   # optional
    with:
      coverage-threshold: 80
      ai-review-blocking: false
```

### Reusable workflow inputs

All inputs are optional:

- `bun-version` - Bun version to install (default `latest`)
- `coverage-threshold` - Minimum coverage percentage (default `80`)
- `run-integration` - Whether to run integration tests (default `false`)
- `integration-test-path` - Path passed to `bun test` for integration tests
- `license-scan-enabled` - Whether to run the license scan (default `false`)
- `ai-review-blocking` - Whether AI findings can fail the run (default `false`)
- `groq-model` - Groq model for AI review
- `ai-max-diff-chars` - Diff chunk size for the AI reviewer
- `bot-repository` - Repo that hosts this bot (default `Falasefemi2/bot-review`)
- `bot-ref` - Branch or tag of the bot to use (default `main`)

### Reusable workflow secrets

- `GROQ_API_KEY` (optional) - Enables the advisory AI review step

### Notes for the target repo

The checks are written for a Bun + TypeScript project. For the deterministic
checks to be meaningful, the target repo should provide the same tooling the
checks invoke: `tsc`, `biome`, `knip`, `madge`, and `bun test` (as dev
dependencies with the corresponding config files). Missing tools are reported
as warnings, not failures.

The `bot-repository` must be public, or the target repo must be able to resolve
it, for the `uses:` reference to work.

## Project layout

```
src/
  app/          Shared services (AppConfig, CommandRunner, GitDiff, AiReviewer, GithubReporter)
  checks/       The 18 check services, grouped by job
  domain/       Core types (CheckResult, CheckRunner, check outcomes)
  main.ts       Entry point: layer composition and job dispatch
test/           Unit tests and check-runner tests
.github/workflows/
  quality-gates.yml             Standalone workflow for this repo
  reusable-quality-gates.yml    Reusable workflow for other repos
```
