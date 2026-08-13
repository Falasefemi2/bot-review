import * as Schema from "effect/Schema"

export const AISeverity = Schema.Literals(["low", "medium", "high"])
export type AISeverity = Schema.Schema.Type<typeof AISeverity>

export const AIFinding = Schema.Struct({
  file: Schema.String,
  line: Schema.optionalKey(Schema.Number),
  severity: AISeverity,
  title: Schema.String,
  reasoning: Schema.String,
})

export interface AIFinding extends Schema.Schema.Type<typeof AIFinding> {}
