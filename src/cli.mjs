#!/usr/bin/env node

import { listScripts } from "./script-registry.mjs";

const command = process.argv[2] ?? "help";

if (command === "doctor") {
  // The same report deveco_doctor returns over MCP. --probe-codegenie is opt-in because starting
  // the child costs a spawn, and the CLI is often run just to check the local toolchain.
  const { collectDoctorReport } = await import("./doctor.mjs");
  const probe = process.argv.includes("--probe-codegenie");
  const { getCodeGenieTools } = probe ? await import("./codegenie-client.mjs") : {};
  console.log(JSON.stringify(
    await collectDoctorReport(probe ? { loadCodeGenieTools: getCodeGenieTools } : {}),
    null,
    2,
  ));
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
           --probe-codegenie  also start the CodeGenie child and report its tools
  scripts  list the allowlisted Skill scripts
  mcp      start the unified stdio MCP server`);
