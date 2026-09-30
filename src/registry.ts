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
  /**
   * Parameters each action uses (besides `action`). A call passing a parameter its action does not
   * use is rejected instead of silently ignored (a misplaced argument must never run with defaults).
   */
  params?: Record<string, string[]>;
  handler(input: z.output<S>, ctx: ToolContext): Promise<unknown>;
}

export function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/**
 * Longest a single call blocks; longer waits are capped (never rejected) and continue with job wait.
 * Kept under the MCP SDK default client request timeout (60s, used e.g. by opencode when no timeout is
 * configured) so a still-running job returns its job_id instead of the client timing out with an empty
 * result. Measured server-side overhead outside the wait is ~10ms; 5s margin covers cold starts.
 */
export const MAX_WAIT_MS = 55000;

/** Shared field helpers keep descriptions consistent across tools. */
export const fields = {
  project: z.string().min(1).describe("Absolute path of the HarmonyOS project root (contains build-profile.json5)"),
  product: z.string().min(1).optional().describe("build-profile product; required only when several exist"),
  modules: z.array(z.string().min(1)).max(64).optional().describe("Module names; default: all modules applicable to the product"),
  target: z.string().min(1).optional().describe("HDC device serial or device name (device action=list). Optional only when exactly one device is connected; with several, ask the user which one"),
  requestKey: z.string().min(1).max(200).optional().describe("Idempotency key: same key+input returns the existing job"),
  wait: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe(`Milliseconds to wait for completion before returning the job (default 1500; larger values are capped at ${MAX_WAIT_MS}, then keep calling job action=wait)`),
};
