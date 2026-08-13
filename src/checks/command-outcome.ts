import type { CommandResult } from "../app/command-runner.js"
import { type CheckOutcome, fail, pass, warn } from "../domain/check-outcome.js"

const MAX_DETAILS = 4000

export const trimDetails = (text: string): string | undefined => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.length > MAX_DETAILS ? `${trimmed.slice(0, MAX_DETAILS)}\n… (truncated)` : trimmed
}

export const outcomeFromExitCode = (
  result: CommandResult,
  options: { readonly passSummary: string; readonly failSummary: string },
): CheckOutcome =>
  result.exitCode === 0
    ? pass(options.passSummary)
    : fail(options.failSummary, trimDetails(result.stderr || result.stdout))

export const outcomeToolMissing = (command: string, message: string): CheckOutcome =>
  warn(`Could not run "${command}" — ${message}`, "Install the tool locally, or add it to the CI workflow.")
