import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { instrument, skipped } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"

const meta = { id: "14", job: "deps", name: "Bundle size" } as const

export interface BundleSizeShape extends CheckRunner {}
export class BundleSize extends Context.Service<BundleSize, BundleSizeShape>()("@checks/deps/BundleSize") {}

// No-op: this project is a backend/CLI tool with no client bundle to measure.
// Kept as a stable placeholder check ID per the check numbering spec.
export const layer = Layer.succeed(
  BundleSize,
  BundleSize.of({
    ...meta,
    run: instrument(meta)(Effect.succeed(skipped("No client bundle in this backend-only project"))),
  }),
)
