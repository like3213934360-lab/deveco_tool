import { z } from "zod";

export const buildRequest = z.strictObject({
  id: z.string().uuid(),
  action: z.literal("build"),
  options: z.strictObject({
    _: z
      .array(
        z.enum([
          "clean",
          "assembleHap",
          "assembleHar",
          "assembleHsp",
          "assembleApp",
          "compileNative",
          "assembleDevHqf",
        ]),
      )
      .max(2),
    mode: z.enum(["module", "project"]),
    prop: z.array(z.string().max(8192)).max(16),
    sync: z.boolean().optional(),
    watch: z.boolean().optional(),
    hotCompile: z.boolean().optional(),
    hotReloadBuild: z.boolean().optional(),
    parallel: z.boolean(),
    incremental: z.boolean(),
    analyze: z.literal("normal"),
    daemon: z.literal(true),
    env: z.strictObject({ DEVECO_SDK_HOME: z.string().min(1) }),
  }),
});
export type BuildOptions = z.infer<typeof buildRequest>["options"];
export const bridgeEvent = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ready"),
    pid: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal("result"),
    id: z.string().uuid(),
    success: z.boolean(),
    message: z.string().max(8192).optional(),
  }),
  z.strictObject({ type: z.literal("fatal"), message: z.string().max(8192) }),
]);
