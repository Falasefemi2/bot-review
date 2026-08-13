import * as BunServices from "@effect/platform-bun/BunServices"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as AppConfig from "../src/app/app-config.js"
import * as CommandRunner from "../src/app/command-runner.js"
import * as ProductionBuild from "../src/checks/deps/production-build.js"

const platform = Layer.mergeAll(BunServices.layer, AppConfig.layer)
const commandRunner = Layer.provide(CommandRunner.layer, platform)
const foundation = Layer.mergeAll(platform, commandRunner)
const provided = Layer.provide(ProductionBuild.layer, foundation)

const prog = Effect.gen(function* () {
  const check = yield* Effect.service(ProductionBuild.ProductionBuild)
  const result = yield* check.run
  console.log(result.status, result.summary)
  console.log(result.details)
})
await Effect.runPromise(Effect.provide(prog, provided))
