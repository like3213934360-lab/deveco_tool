/**
 * @file The environment report behind both `deveco-tool doctor` and the deveco_doctor MCP tool.
 * @author deveco-tool
 *
 * These two used to be assembled separately: the MCP tool reported Python, the ArkTS checker,
 * the DevEco CLI, the language server, HDC and login state, while the CLI reported only the
 * environment and the script registry -- even though PACK.md told people to run the CLI to check
 * exactly the things it did not check. Both now render this one report, so they cannot drift again.
 */

import { arktsCheckStatus } from "./arkts-check.mjs";
import { PROXIED_CODEGENIE_TOOL_NAMES } from "./codegenie-tools.mjs";
import { collectEnvironmentStatus } from "./config.mjs";
import { devecoCliStatus } from "./deveco-cli.mjs";
import { hdcStatus } from "./hdc-log.mjs";
import { lspStatus } from "./lsp.mjs";
import { authStatus } from "./modules/auth.mjs";
import { getProjectContext } from "./project-context.mjs";
import { listScripts, pythonStatus } from "./script-registry.mjs";

// Unlike tools/list, doctor is invoked precisely to find out whether the child works, so it waits
// for a definitive answer instead of guessing. The budget covers a full retry cycle (2 attempts x
// two 5s timeouts) because the upstream handshake stalls intermittently -- measured here as 99ms,
// 99ms, then 5187ms across three cold starts, the last being a first-attempt stall plus a
// successful retry. Reporting "unknown" on that would hide the very defect worth reporting.
export const CODEGENIE_PROBE_MS = 15000;

// A healthy handshake is about 100ms. Anything past this is the intermittent stall showing up, and
// that is a finding rather than noise: it is why tools/list is answered from a static table.
const CODEGENIE_SLOW_MS = 1000;

/**
 * Ask for the CodeGenie child's tools, recording how long it took.
 * @param {() => Promise<Array<{name: string}>>} loadTools Loader for the child's tool list.
 * @returns {Promise<{tools: Array<{name: string}>|null, elapsedMs: number}>} The child's tools
 *   (null if it never answered) and the elapsed time, which is itself diagnostic.
 */
async function probeCodeGenie(loadTools) {
  const startedAt = Date.now();
  const tools = await Promise.race([
    loadTools().catch(() => []),
    new Promise((resolve) => {
      setTimeout(() => resolve(null), CODEGENIE_PROBE_MS).unref();
    }),
  ]);
  return { tools, elapsedMs: Date.now() - startedAt };
}

/**
 * Collect the full local environment report.
 * @param {{loadCodeGenieTools?: () => Promise<Array<{name: string}>>}} [options] Injection point for the
 *   CodeGenie loader, so the MCP server can reuse its own memoised one instead of spawning a second child.
 * @returns {Promise<object>} The report, shaped identically for both callers.
 */
export async function collectDoctorReport(options = {}) {
  const probe = options.loadCodeGenieTools
    ? await probeCodeGenie(options.loadCodeGenieTools)
    : null;
  const proxied = probe?.tools ?? null;

  return {
    environment: collectEnvironmentStatus(),
    project: getProjectContext(),
    scripts: listScripts(),
    python: await pythonStatus(),
    codegenie: {
      // Advertised from a static table, so these stay callable names even when the child is down.
      advertised: PROXIED_CODEGENIE_TOOL_NAMES,
      available: probe === null ? "not probed" : proxied !== null && proxied.length > 0,
      toolCount: proxied === null ? null : proxied.length,
      ...(probe === null ? {} : { handshakeMs: probe.elapsedMs }),
      ...(probe !== null && proxied === null
        ? { note: `child did not answer within ${CODEGENIE_PROBE_MS}ms; the proxied tools stay advertised and fail on call` }
        : {}),
      ...(proxied !== null && probe.elapsedMs > CODEGENIE_SLOW_MS
        ? { note: `handshake took ${probe.elapsedMs}ms; upstream stalls intermittently and retries, which is why tools/list never waits on this child` }
        : {}),
    },
    arktsChecker: arktsCheckStatus(),
    devecoCli: devecoCliStatus(),
    lsp: lspStatus(),
    hdc: hdcStatus(),
    auth: await authStatus(),
  };
}
