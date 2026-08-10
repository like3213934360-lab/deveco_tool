import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { REPO_ROOT, resolveDevecoHome } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";

let client;
let transport;
let childTools = [];
let boundProject = null;
let starting = null;

// The CodeGenie child normally completes its handshake in about 100ms, but it
// intermittently never completes it at all -- no error, no exit, just silence.
// Every step that waits on it is bounded so that turns into a clean failure,
// and a stall is retried once: clients cache the first tools/list, so losing
// that one attempt would hide build_project and start_app for the whole session.
const HANDSHAKE_TIMEOUT_MS = 5000;
const HANDSHAKE_ATTEMPTS = 2;

/**
 * Ceiling for one proxied tool call.
 *
 * The SDK already applies DEFAULT_REQUEST_TIMEOUT_MSEC (60s), so calls were never unbounded -- but
 * a bound is not a recovery. Nothing reacted to it, so the wedged child stayed wedged and the next
 * call waited the full 60s again. Setting our own slightly lower ceiling means the timeout is ours
 * to act on. 45s clears the slowest legitimate proxied call measured (`get_app_ui_tree full` at
 * 26s) with room to spare.
 */
// DEVECO_CODEGENIE_CALL_TIMEOUT_MS is a test seam, matching how DEVECO_CODEGENIE_ENTRY lets the
// tests point at a stand-in child: tripping the breaker for real would take three 45-second waits.
const CALL_TIMEOUT_MS = Number(process.env.DEVECO_CODEGENIE_CALL_TIMEOUT_MS) || 45000;

/**
 * After this many consecutive timeouts, stop paying CALL_TIMEOUT_MS to rediscover that the child is
 * broken and fail immediately for a cooldown. Any success resets it.
 */
const CIRCUIT_TRIP_AFTER = 3;
const CIRCUIT_COOLDOWN_MS = 60000;

let consecutiveTimeouts = 0;
let circuitOpenedAt = 0;

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = "CODEGENIE_TIMEOUT";
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function wrapperPath() {
  // DEVECO_CODEGENIE_ENTRY is a test seam, matching how HDC_PATH lets the hdc
  // tests point at a stand-in binary.
  return process.env.DEVECO_CODEGENIE_ENTRY
    || path.join(REPO_ROOT, "node_modules", "@deveco-codegenie", "mcp", "index.js");
}

function childEnvironment() {
  const devecoHome = resolveDevecoHome().path;
  return {
    ...(devecoHome ? { DEVECO_PATH: devecoHome, DEVECO_HOME: devecoHome } : {}),
    // UI_VERIFY_* is deliberately not forwarded: the gateway disables the
    // verify_ui chain, so passing model credentials through would be dead config.
    ...(process.env.PROJECT_PATH ? { PROJECT_PATH: process.env.PROJECT_PATH } : {}),
  };
}

async function handshake() {
  try {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [wrapperPath()],
      cwd: REPO_ROOT,
      env: childEnvironment(),
      stderr: "inherit",
    });
    // CodeGenie asks its parent for roots during initialization. The unified
    // gateway manages project context explicitly through switch_cwd, so return
    // an empty roots list instead of letting that optional request hang.
    client = new Client(
      { name: "deveco-tool-gateway", version: "0.1.0" },
      { capabilities: { roots: { listChanged: false } } },
    );
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [] }));
    await withTimeout(
      client.connect(transport),
      HANDSHAKE_TIMEOUT_MS,
      `CodeGenie MCP did not complete its handshake within ${HANDSHAKE_TIMEOUT_MS}ms`,
    );
    const result = await withTimeout(
      client.listTools(),
      HANDSHAKE_TIMEOUT_MS,
      `CodeGenie MCP did not answer tools/list within ${HANDSHAKE_TIMEOUT_MS}ms`,
    );
    childTools = result.tools ?? [];
    return childTools;
  } catch (error) {
    // Leave no half-connected client behind, so the next call starts clean.
    await closeCodeGenie().catch(() => {});
    throw error;
  }
}

export async function ensureCodeGenie() {
  if (client && !starting) return childTools;
  if (!starting) {
    starting = handshake().finally(() => { starting = null; });
  }
  return starting;
}

export async function getCodeGenieTools() {
  let lastError;
  for (let attempt = 1; attempt <= HANDSHAKE_ATTEMPTS; attempt += 1) {
    try {
      return await ensureCodeGenie();
    } catch (error) {
      lastError = error;
      await closeCodeGenie().catch(() => {});
      // Only a stall is worth another spawn; a missing package or a crash on
      // startup will fail exactly the same way the second time.
      if (error.code !== "CODEGENIE_TIMEOUT") break;
    }
  }
  const wrapped = new Error(`CodeGenie MCP unavailable: ${lastError.message}`);
  wrapped.code = "CODEGENIE_UNAVAILABLE";
  throw wrapped;
}

async function syncProjectPath() {
  const projectPath = getProjectPath();
  if (!projectPath || boundProject === projectPath) return;
  if (!childTools.some((tool) => tool.name === "init_project_path")) return;
  await client.callTool(
    { name: "init_project_path", arguments: { project_path: projectPath } },
    undefined,
    { timeout: CALL_TIMEOUT_MS },
  );
  boundProject = projectPath;
}

/** The SDK reports its own deadline as an McpError with this JSON-RPC code. */
function isTimeout(error) {
  return error?.code === -32001 || error?.code === "CODEGENIE_TIMEOUT"
    || /timed out|timeout/i.test(String(error?.message ?? ""));
}

function circuitRemainingMs() {
  if (consecutiveTimeouts < CIRCUIT_TRIP_AFTER) return 0;
  return Math.max(0, CIRCUIT_COOLDOWN_MS - (Date.now() - circuitOpenedAt));
}

export async function callCodeGenieTool(name, args = {}) {
  const cooling = circuitRemainingMs();
  if (cooling > 0) {
    const error = new Error(
      `CodeGenie MCP timed out ${consecutiveTimeouts} times in a row; not retrying for another ${Math.ceil(cooling / 1000)}s`,
    );
    error.code = "CODEGENIE_CIRCUIT_OPEN";
    error.hint = "Run deveco_doctor to check the DevEco install and project configuration."
      + " The local tools, including the ui_* device fast path, do not depend on this child.";
    throw error;
  }

  // getCodeGenieTools rather than ensureCodeGenie: since tools/list stopped touching the child,
  // a call is the first thing that starts it, so it needs the same retry-a-stalled-spawn
  // behaviour and the same CODEGENIE_UNAVAILABLE wrapper that tool discovery used to provide.
  await getCodeGenieTools();
  await syncProjectPath();
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
    consecutiveTimeouts = 0;
    return result;
  } catch (error) {
    if (!isTimeout(error)) throw error;
    // Deliberately no retry. Some proxied tools write -- perform_ui_action taps the screen -- and a
    // timeout says the request was never answered, not that it never landed, so replaying it could
    // tap twice. Tearing the child down is the recovery: the next call spawns a fresh one.
    consecutiveTimeouts += 1;
    if (consecutiveTimeouts === CIRCUIT_TRIP_AFTER) circuitOpenedAt = Date.now();
    await closeCodeGenie().catch(() => {});
    const wrapped = new Error(`CodeGenie MCP did not answer ${name} within ${CALL_TIMEOUT_MS}ms`);
    wrapped.code = "CODEGENIE_TIMEOUT";
    wrapped.hint = "The child has been torn down; the next call starts a fresh one. Nothing was retried,"
      + " because a proxied call may have already taken effect on the device.";
    throw wrapped;
  }
}

/**
 * Clear the timeout streak, so an operator who has just fixed something is not made to wait out a
 * cooldown that was measuring the old state. Wired to deveco_restart, which is exactly that signal.
 *
 * Not folded into closeCodeGenie: the timeout path calls that too, and resetting there would mean
 * the counter never reached the trip threshold.
 *
 * @returns {void}
 */
export function resetCodeGenieCircuit() {
  consecutiveTimeouts = 0;
  circuitOpenedAt = 0;
}

export async function closeCodeGenie() {
  const activeClient = client;
  const activeTransport = transport;
  client = undefined;
  transport = undefined;
  childTools = [];
  boundProject = null;
  starting = null;
  if (activeClient) {
    await activeClient.close();
  } else if (activeTransport) {
    await activeTransport.close();
  }
}
