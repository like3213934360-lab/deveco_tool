import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { REPO_ROOT, resolveDevecoHome } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";

let client;
let transport;
let childTools = [];
let boundProject = null;

function wrapperPath() {
  return path.join(REPO_ROOT, "node_modules", "@deveco-codegenie", "mcp", "index.js");
}

function childEnvironment() {
  const devecoHome = resolveDevecoHome().path;
  return {
    ...(devecoHome ? { DEVECO_PATH: devecoHome, DEVECO_HOME: devecoHome } : {}),
    ...(process.env.UI_VERIFY_BASE_URL ? { UI_VERIFY_BASE_URL: process.env.UI_VERIFY_BASE_URL } : {}),
    ...(process.env.UI_VERIFY_API_KEY ? { UI_VERIFY_API_KEY: process.env.UI_VERIFY_API_KEY } : {}),
    ...(process.env.UI_VERIFY_MODEL_NAME ? { UI_VERIFY_MODEL_NAME: process.env.UI_VERIFY_MODEL_NAME } : {}),
    ...(process.env.PROJECT_PATH ? { PROJECT_PATH: process.env.PROJECT_PATH } : {}),
  };
}

export async function ensureCodeGenie() {
  if (client) return childTools;

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [wrapperPath()],
    cwd: REPO_ROOT,
    env: childEnvironment(),
    stderr: "inherit",
  });
  client = new Client({ name: "deveco-tool-gateway", version: "0.1.0" });
  await client.connect(transport);
  const result = await client.listTools();
  childTools = result.tools ?? [];
  return childTools;
}

export async function getCodeGenieTools() {
  try {
    return await ensureCodeGenie();
  } catch (error) {
    client = undefined;
    transport = undefined;
    childTools = [];
    const wrapped = new Error(`CodeGenie MCP unavailable: ${error.message}`);
    wrapped.code = "CODEGENIE_UNAVAILABLE";
    throw wrapped;
  }
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
  if (transport) await transport.close();
  client = undefined;
  transport = undefined;
  childTools = [];
  boundProject = null;
}
