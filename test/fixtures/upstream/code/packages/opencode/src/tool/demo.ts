import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const operations = ["goToDefinition", "incomingCalls"] as const

const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "Op" }),
  filePath: Schema.String.annotate({
    description: "File",
  }),
  mode: Schema.optional(Schema.Literals(["a", "b"])),
})

const id = "demo_tool"

export const DemoTool = Tool.define(
  id,
  Effect.gen(function* () {
    return { description: "Demo", parameters: Parameters, execute: () => Effect.succeed(undefined) }
  }),
)
