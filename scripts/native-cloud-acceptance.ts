import { finishAcceptance } from "./lib/acceptance-report.js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult, invariant, ToolError } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

/** Interactive credentials stay encrypted in this dedicated state directory.
 * This probe only logs in and reads inventories; it creates no cloud signing assets. */
const root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Acceptance directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const tested = evidenceIdentity(),
  runtime = new Runtime();
const observations: {
  name: string;
  elapsed_ms: number;
  result?: unknown;
  error?: unknown;
}[] = [];
let failed = false, completed = false;
async function observe<T>(
  name: string,
  task: () => Promise<T>,
): Promise<T | undefined> {
  const started = performance.now();
  try {
    const result = await task();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${name}: passed\n`);
    return result;
  } catch (error) {
    failed = true;
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    process.stdout.write(`${name}: failed\n`);
    return undefined;
  } finally {
    atomicWrite(
      path.join(root, "evidence.json"),
      JSON.stringify({ tested, observations }, null, 2),
    );
  }
}
try {
  const authenticated = await observe("developer_browser_login", async () => {
    const result = await runtime.auth.login("developer", false);
    // This URL is the public authorization entry with a one-time callback nonce.
    // Do not log callback URLs, temporary tokens or authentication response bodies.
    process.stdout.write(
      JSON.stringify({ login_url: result.login_url }) + "\n",
    );
    for (;;) {
      const status = runtime.auth.status("developer");
      if (status.logged_in) return { logged_in: true };
      if (status.error)
        throw new ToolError(status.error.code, status.error.message);
      invariant(
        status.login_pending,
        "LOGIN_INCOMPLETE",
        "Login ended without authentication",
      );
      await delay(250);
    }
  });
  if (authenticated) {
    const teams = await observe("developer_teams", () => runtime.auth.teams());
    for (const team of teams?.teams ?? []) {
      await observe(`certificate_inventory:${team.id}`, async () => {
        const result = z
          .object({
            certificates: z.array(
              z.object({ id: z.string(), certName: z.string() }),
            ),
          })
          .parse(
            await runtime.signatures.call({
              action: "certificates",
              team_id: team.id,
            }),
          );
        return { count: result.certificates.length };
      });
      await observe(`device_inventory:${team.id}`, async () => {
        const result = z
          .object({ devices: z.array(z.object({ id: z.string() })) })
          .parse(
            await runtime.signatures.call({
              action: "devices",
              team_id: team.id,
            }),
          );
        return { count: result.devices.length };
      });
    }
    await observe("credential_provider_isolation", async () => {
      assert.equal(runtime.auth.status("codegenie").logged_in, false);
      await assert.rejects(runtime.auth.credentials("codegenie"), {
        code: "AUTH_REQUIRED",
      });
      return { codegenie_logged_in: false };
    });
  }
  completed = true;
} finally {
  const closed = await runtime.close();
  assert.equal(closed.closed, true, JSON.stringify(closed));
  finishAcceptance(path.join(root, "evidence.json"), tested, completed && !failed, closed.closed);
}
