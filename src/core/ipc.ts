import { z } from "zod";
import { tools, type ToolName } from "./contracts.js";
export const ipcInput = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("call"),
    id: z.string().uuid(),
    name: z.enum(Object.keys(tools) as ToolName[]),
    input: z.unknown(),
  }),
  z.strictObject({ type: z.literal("cancel"), id: z.string().uuid() }),
  z.strictObject({ type: z.literal("close"), id: z.string().uuid() }),
]);
export const ipcOutput = z.strictObject({
  id: z.string().uuid(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      retryable: z.boolean(),
    })
    .optional(),
});
