import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { z } from "zod";
import { inside } from "../core/files.js";
import { invariant, ToolError } from "../core/errors.js";

const section = z
  .object({
    files: z.array(z.string().min(1)).optional(),
    ignore: z.array(z.string().min(1)).optional(),
    ruleSet: z.array(z.string().min(1)).optional(),
    rules: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const configuration = section.extend({
  overrides: z.array(section).optional(),
});

/** Validate before launching the SDK: its lenient parser can repair broken
 * JSON5 into an empty configuration and still return a successful report. */
export async function lintInput(
  root: string,
  input: { path?: string; config_path?: string },
  signal?: AbortSignal,
): Promise<{ target: string; config: string }> {
  signal?.throwIfAborted();
  const canonicalRoot = await fs.promises.realpath(root);
  let target: string;
  try {
    target = await fs.promises.realpath(path.resolve(root, input.path ?? "."));
    inside(canonicalRoot, target);
    const stat = await fs.promises.stat(target);
    invariant(
      stat.isFile() || stat.isDirectory(),
      "LINT_PATH_INVALID",
      "Linter scope must be a file or directory",
    );
  } catch (error) {
    throw new ToolError(
      "LINT_PATH_INVALID",
      "Linter scope must exist inside the captured project",
      {
        reason: error instanceof Error ? error.message : "Invalid path",
      },
    );
  }
  const config = path.resolve(root, input.config_path ?? "code-linter.json5");
  try {
    const handle = await fs.promises.open(
      config,
      fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      invariant(
        before.isFile() && before.size <= 1024 * 1024,
        "LINT_CONFIG_INVALID",
        "Linter config must be a regular file no larger than 1 MiB",
      );
      const data = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < data.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(
          data,
          offset,
          data.length - offset,
          offset,
        );
        invariant(
          bytesRead > 0,
          "LINT_CONFIG_INVALID",
          "Linter config changed during validation",
        );
        offset += bytesRead;
      }
      const after = await handle.stat();
      invariant(
        before.size === after.size &&
          before.mtimeMs === after.mtimeMs &&
          before.ctimeMs === after.ctimeMs,
        "LINT_CONFIG_INVALID",
        "Linter config changed during validation",
      );
      configuration.parse(JSON5.parse(data.toString("utf8")) as unknown);
    } finally {
      await handle.close();
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw new ToolError(
      "LINT_CONFIG_INVALID",
      "Linter config must contain valid JSON5 and configuration fields",
      {
        path: config,
        reason:
          error instanceof Error
            ? error.message.slice(0, 2048)
            : "Invalid configuration",
      },
    );
  }
  signal?.throwIfAborted();
  return { target, config };
}
