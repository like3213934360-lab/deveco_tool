import fs from "node:fs";
import { z } from "zod";
import { atomicWrite } from "../../src/core/files.js";
import { errorResult } from "../../src/core/errors.js";
import { evidenceIdentity } from "./evidence.js";

/** Final success requires the entire script and cleanup, with unchanged tested
 * bytes. Intermediate observations alone never form a passing report. */
export function finishAcceptance(file: string, tested: ReturnType<typeof evidenceIdentity>, completed: boolean, closed: boolean, extra: Record<string, unknown> = {}) {
  const report = fs.existsSync(file) ? z.record(z.string(), z.unknown()).parse(JSON.parse(fs.readFileSync(file, "utf8"))) : {};
  let unchanged = false, identityError: unknown;
  try {
    const after = evidenceIdentity();
    unchanged = (["runtime_sha256", "compiled_sha256", "package_lock_sha256", "resource_manifest_sha256", "upstream_lock_sha256"] as const).every((key) => tested[key] === after[key]);
  } catch (error) { identityError = errorResult(error); }
  const passed = completed && closed && unchanged;
  atomicWrite(file, JSON.stringify({ ...report, ...extra, tested, completed, closed, unchanged, passed, ...(identityError ? { identity_error: identityError } : {}) }, null, 2) + "\n");
  if (!passed) process.exitCode = 1;
  return passed;
}
