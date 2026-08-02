#!/usr/bin/env node

import { collectEnvironmentStatus } from "./config.mjs";
import { listScripts } from "./script-registry.mjs";

const command = process.argv[2] ?? "help";

if (command === "doctor") {
  console.log(JSON.stringify({ environment: collectEnvironmentStatus(), scripts: listScripts() }, null, 2));
  process.exit(0);
}

if (command === "scripts") {
  console.log(JSON.stringify({ scripts: listScripts() }, null, 2));
  process.exit(0);
}

if (command === "mcp") {
  await import("./server.mjs");
  process.exit(0);
}

console.log(`deveco-tool commands:
  doctor   inspect the local DevEco environment
  scripts  list the allowlisted Skill scripts
  mcp      start the unified stdio MCP server`);
