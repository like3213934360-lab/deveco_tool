import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { atomicWrite, fileDigest, digest } from "../src/core/files.js";
import { invariant } from "../src/core/errors.js";

// Offline migration evidence only; the native MCP never imports or launches this baseline.
const baselineCommit = "aab1405b51e00e4036bdc8f18ae4229835de77b0";
const [baseline, output] = z
  .tuple([z.string().min(1), z.string().min(1)])
  .parse(process.argv.slice(2))
  .map((file) => path.resolve(file)) as [string, string];
invariant(
  !fs.existsSync(output),
  "INVENTORY_EXISTS",
  "Refusing to overwrite a frozen baseline inventory",
);
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: baseline,
    encoding: "utf8",
    timeout: 10000,
  }).trim();
invariant(
  git("rev-parse", "HEAD") === baselineCommit,
  "BASELINE_CHANGED",
  "Baseline checkout does not match the frozen migration commit",
);
invariant(
  git("status", "--porcelain", "--untracked-files=no") === "",
  "BASELINE_DIRTY",
  "Baseline tracked files must be unchanged",
);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-inventory-"));
const client = new Client({ name: "migration-inventory", version: "1" });
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (value): value is [string, string] => value[1] !== undefined,
  ),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(baseline, "src/server.mjs")],
  cwd: baseline,
  stderr: "ignore",
  env: { ...env, DEVECO_STATE_DIR: temporary },
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const scripts = z
    .array(z.string())
    .parse(
      tools.find((tool) => tool.name === "deveco_script")?.inputSchema
        .properties?.script &&
        z
          .object({ enum: z.array(z.string()) })
          .parse(
            tools.find((tool) => tool.name === "deveco_script")!.inputSchema
              .properties!.script,
          ).enum,
    );
  const contracts: { id: string; response: unknown }[] = [];
  for (const id of scripts) {
    const result = await client.callTool({
      name: "deveco_script_catalog",
      arguments: { script: id },
    });
    const parsed = z
      .object({
        isError: z.boolean().optional(),
        content: z.array(
          z.object({ type: z.string(), text: z.string().optional() }),
        ),
      })
      .parse(result);
    invariant(
      !parsed.isError,
      "BASELINE_CATALOG_FAILED",
      "Could not read registered script contract",
    );
    const body = parsed.content.find((item) => item.type === "text")?.text;
    invariant(
      body,
      "BASELINE_CATALOG_FAILED",
      "Registered script contract has no JSON body",
    );
    contracts.push({ id, response: JSON.parse(body) as unknown });
  }
  const inventory = {
    baseline_commit: baselineCommit,
    baseline_tree: git("rev-parse", "HEAD^{tree}"),
    lock_sha256: fileDigest(path.join(baseline, "package-lock.json")),
    captured_at: new Date().toISOString(),
    node: process.version,
    tools: tools
      .map(({ name, description, inputSchema }) => ({
        name,
        description,
        input_schema: inputSchema,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    scripts: contracts,
  };
  atomicWrite(
    output,
    JSON.stringify(
      {
        ...inventory,
        inventory_sha256: digest({
          tools: inventory.tools,
          scripts: inventory.scripts,
        }),
      },
      null,
      2,
    ) + "\n",
    false,
  );
  console.log(
    JSON.stringify({ tools: tools.length, scripts: scripts.length, output }),
  );
} finally {
  await transport.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
