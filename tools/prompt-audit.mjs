// Protocol bytes, not model tokens. A host that repeats instructions needs a separate budget.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./mcp-client.mjs";

export function promptMetrics(instructions, tools) {
  const bytes = (value) => Buffer.byteLength(value, "utf8");
  return {
    tools: tools.length,
    instructions_bytes: bytes(instructions),
    tools_list_bytes: bytes(JSON.stringify({ tools })),
    // Controlled comparison of the same JSON tools, with one instruction prefix per tool.
    repeated_instructions_bytes: bytes(JSON.stringify({ tools: tools.map((t) => ({ ...t, description: `${instructions}\n\n${t.description}` })) })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--snapshot"), "Usage: node tools/prompt-audit.mjs [--snapshot <file>]");
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-prompt-"));
  const client = connect({ DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") });
  try {
    const init = await client.initialize(), list = await client.request("tools/list");
    assert.ok(!init.error && !list.error, JSON.stringify({ init, list }));
    const { serverInfo, instructions } = init.result, { tools } = list.result;
    const metrics = promptMetrics(instructions, tools);
    if (args.length) fs.writeFileSync(args[1], JSON.stringify({ serverInfo, instructions, tools, metrics }, null, 2) + "\n");
    console.log(JSON.stringify({ ...serverInfo, ...metrics }, null, 2));
  } finally {
    await client.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
}
