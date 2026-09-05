import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CodeGenieTransport } from "./codegenie-transport.mjs";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { REPO_ROOT, resolveDevecoHome, resolveDevecoToolchain } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";

let client;
let transport;
let childTools = [];
let boundProject = null;
let starting = null;
let generation = 0;
let callQueue = Promise.resolve();

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
  const toolchain = resolveDevecoToolchain();
  return {
    ...(devecoHome && toolchain.kind === "studio" ? { DEVECO_PATH: devecoHome, DEVECO_HOME: devecoHome } : {}),
    ...(toolchain.kind === "clt" ? { DEVECO_CLI_CLT_PATH: toolchain.root } : {}),
    // UI_VERIFY_* is deliberately not forwarded: the gateway disables the
    // verify_ui chain, so passing model credentials through would be dead config.
    ...(getProjectPath() ? { PROJECT_PATH: getProjectPath() } : {}),
  };
}

async function handshake() {
  const epoch = generation;
  const localTransport = new CodeGenieTransport({
    command: process.execPath, args: [wrapperPath()], cwd: REPO_ROOT, env: childEnvironment(),
  });
  const localClient = new Client(
    { name: "deveco-tool-gateway", version: "0.1.0" },
    { capabilities: { roots: { listChanged: false } } },
  );
  transport = localTransport;
  client = localClient;
  localClient.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [] }));
  localClient.onclose = () => {
    if (client === localClient) {
      client = undefined;
      transport = undefined;
      childTools = [];
      boundProject = null;
    }
  };
  try {
    await withTimeout(localClient.connect(localTransport), HANDSHAKE_TIMEOUT_MS,
      `CodeGenie MCP did not complete its handshake within ${HANDSHAKE_TIMEOUT_MS}ms`);
    const result = await withTimeout(localClient.listTools(), HANDSHAKE_TIMEOUT_MS,
      `CodeGenie MCP did not answer tools/list within ${HANDSHAKE_TIMEOUT_MS}ms`);
    if (epoch !== generation || client !== localClient) throw new Error("CodeGenie startup was superseded by a restart");
    childTools = result.tools ?? [];
    return childTools;
  } catch (error) {
    await localTransport.close().catch(() => {});
    if (client === localClient) {
      client = undefined;
      transport = undefined;
      childTools = [];
      boundProject = null;
    }
    throw error;
  }
}

export async function ensureCodeGenie() {
  if (client && !starting) return childTools;
  if (!starting) {
    const pending = handshake().finally(() => { if (starting === pending) starting = null; });
    starting = pending;
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
      // Only a stall is worth another spawn; a missing package or a crash on
      // startup will fail exactly the same way the second time.
      if (error.code !== "CODEGENIE_TIMEOUT") break;
    }
  }
  const wrapped = new Error(`CodeGenie MCP unavailable: ${lastError.message}`);
  wrapped.code = "CODEGENIE_UNAVAILABLE";
  throw wrapped;
}

async function syncProjectPath(activeClient, projectPath) {
  if (!projectPath || boundProject === projectPath) return;
  if (!childTools.some((tool) => tool.name === "init_project_path")) return;
  // A rejected initialization may already have changed part of the child's
  // state. Require a fresh bind even when the next call selects the old project.
  boundProject = null;
  const result = await activeClient.callTool(
    { name: "init_project_path", arguments: { project_path: projectPath } },
    undefined,
    { timeout: CALL_TIMEOUT_MS },
  );
  if (result.isError) {
    const detail = (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
    const error = new Error(`CodeGenie rejected project ${projectPath}: ${detail}`);
    error.code = "CODEGENIE_PROJECT_SYNC_FAILED";
    throw error;
  }
  if (client !== activeClient) throw new Error("CodeGenie restarted while switching projects");
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

// Binding and the dependent call are one transaction. Capture the requested
// project before queuing; another switch must not redirect an in-flight request.
export function callCodeGenieTool(name, args = {}) {
  const projectPath = getProjectPath();
  const pending = callQueue.then(() => callBoundTool(name, args, projectPath));
  callQueue = pending.catch(() => {});
  return pending;
}

async function callBoundTool(name, args, projectPath) {
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
  const activeClient = client;
  try {
    await syncProjectPath(activeClient, projectPath);
    const result = await activeClient.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
    consecutiveTimeouts = 0;
    return result;
  } catch (error) {
    if (!isTimeout(error)) throw error;
    // Deliberately no retry. Some proxied tools write -- perform_ui_action taps the screen -- and a
    // timeout says the request was never answered, not that it never landed, so replaying it could
    // tap twice. Tearing the child down is the recovery: the next call spawns a fresh one.
    consecutiveTimeouts += 1;
    if (consecutiveTimeouts === CIRCUIT_TRIP_AFTER) circuitOpenedAt = Date.now();
    if (client === activeClient) await closeCodeGenie().catch(() => {});
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
  generation += 1;
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

/** Doctor checks the running child, not a previously successful handshake. */
export async function probeCodeGenieTools() {
  await getCodeGenieTools();
  const activeClient = client;
  try {
    const result = await withTimeout(activeClient.listTools(), HANDSHAKE_TIMEOUT_MS,
      "CodeGenie MCP did not answer the doctor probe");
    if (client !== activeClient) throw new Error("CodeGenie restarted during the doctor probe");
    childTools = result.tools ?? [];
    return childTools;
  } catch (error) {
    if (client === activeClient) await closeCodeGenie().catch(() => {});
    throw error;
  }
}
