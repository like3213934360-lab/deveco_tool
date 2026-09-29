import { z } from "zod";

export interface ToolContext {
  signal: AbortSignal;
}
/** Handlers may attach one image; the server emits it as MCP image content. */
export interface ImageResult {
  _image?: { data: string; mime: string };
}
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  schema: S;
  readOnly?: boolean;
  handler(input: z.output<S>, ctx: ToolContext): Promise<unknown>;
}

export function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/** Shared field helpers keep descriptions consistent across tools. */
export const fields = {
  project: z.string().min(1).describe("Absolute path of the HarmonyOS project root (contains build-profile.json5)"),
  product: z.string().min(1).optional().describe("build-profile product; required only when several exist"),
  modules: z.array(z.string().min(1)).max(64).optional().describe("Module names; default: all modules applicable to the product"),
  target: z.string().min(1).optional().describe("HDC device serial; optional when exactly one device is connected"),
  requestKey: z.string().min(1).max(200).optional().describe("Idempotency key: same key+input returns the existing job"),
  wait: z.number().int().min(0).max(60000).optional().describe("Milliseconds to wait for completion before returning the job (default 1500)"),
};
