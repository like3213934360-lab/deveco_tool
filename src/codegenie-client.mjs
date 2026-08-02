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
  await client.callTool({
    name: "init_project_path",
    arguments: { project_path: projectPath },
  });
  boundProject = projectPath;
}

export async function callCodeGenieTool(name, args = {}) {
  await ensureCodeGenie();
  await syncProjectPath();
  return client.callTool({ name, arguments: args });
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
