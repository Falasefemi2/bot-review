import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { AppConfig, type AppConfigShape } from "../../app/app-config.js"
import { fail, instrument, pass, skipped } from "../../domain/check-outcome.js"
import type { CheckRunner } from "../../domain/check-result.js"

const meta = { id: "8", job: "deps", name: "License compliance scan" } as const

const UNLICENSED = /^(UNLICENSED|SEE LICENSE|PROPRIETARY|LICENSE NOT SPECIFIED)$/i

interface LicenseInfo {
  readonly package: string
  readonly reason: string
}

interface PackageManifest {
  readonly license?: unknown
  readonly licenses?: unknown
}

const parseManifest = (content: string): Option.Option<PackageManifest> => {
  try {
    return Option.some(JSON.parse(content) as PackageManifest)
  } catch {
    return Option.none()
  }
}

const licenseOf = (manifest: PackageManifest): string => {
  const license = manifest.license ?? manifest.licenses
  if (typeof license === "string") return license
  if (typeof license === "object" && license !== null && "type" in license && typeof license.type === "string") {
    return license.type
  }
  return ""
}

const inspectManifest = (file: string, manifest: PackageManifest): Option.Option<LicenseInfo> => {
  const license = licenseOf(manifest)
  if (license.length === 0) return Option.some({ package: file, reason: "no license field" })
  return UNLICENSED.test(license) ? Option.some({ package: file, reason: `license is ${license}` }) : Option.none()
}

const readLicense = (fs: FileSystem.FileSystem, file: string): Effect.Effect<LicenseInfo | undefined, never> =>
  fs.readFileString(file).pipe(
    Effect.map(parseManifest),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(undefined as LicenseInfo | undefined),
        onSome: (manifest) => Effect.succeed(inspectManifest(file, manifest).pipe(Option.getOrUndefined)),
      }),
    ),
    Effect.catchTag(PLATFORM_ERROR_TAG, () => Effect.succeed(undefined)),
  )

const PLATFORM_ERROR_TAG = "PlatformError"

const listLicenses = (fs: FileSystem.FileSystem, packageJsonPaths: readonly string[]) =>
  Effect.all(
    packageJsonPaths.map((path) => readLicense(fs, path)),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((rows) => rows.filter((row): row is LicenseInfo => row !== undefined)))

export interface LicenseScanShape extends CheckRunner {}
export class LicenseScan extends Context.Service<LicenseScan, LicenseScanShape>()("@checks/deps/LicenseScan") {}

export const layer = Layer.effect(
  LicenseScan,
  Effect.gen(function* () {
    const config: AppConfigShape = yield* AppConfig
    const fs = yield* FileSystem.FileSystem

    const run = instrument(meta)(
      Effect.gen(function* () {
        if (!config.gates.licenseScanEnabled) {
          return skipped("License scan disabled (LICENSE_SCAN_ENABLED=false)")
        }
        const entries = yield* fs
          .readDirectory("node_modules")
          .pipe(Effect.catchTag(PLATFORM_ERROR_TAG, () => Effect.succeed<string[]>([])))
        const scoped = yield* Effect.all(
          entries.map((entry) =>
            entry.startsWith("@")
              ? fs.readDirectory(`node_modules/${entry}`).pipe(
                  Effect.map((nested) => nested.map((name) => `node_modules/${entry}/${name}/package.json`)),
                  Effect.catchTag(PLATFORM_ERROR_TAG, () => Effect.succeed([])),
                )
              : Effect.succeed([`node_modules/${entry}/package.json`]),
          ),
          { concurrency: "unbounded" },
        )
        const licensePaths = scoped.flat()
        const violations = yield* listLicenses(fs, licensePaths)
        return violations.length === 0
          ? pass(`License fields present in ${licensePaths.length} installed packages`)
          : fail(
              `${violations.length} package(s) with missing/unlicensed license fields`,
              violations.map((v) => `${v.package}: ${v.reason}`).join("\n"),
            )
      }),
    )

    return LicenseScan.of({ ...meta, run })
  }),
)
