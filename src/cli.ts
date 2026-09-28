#!/usr/bin/env node
/* Entry: `deveco-mcp [mcp]` serves stdio; `doctor` and `kb-build` are local helpers. */

// node:sqlite prints an ExperimentalWarning on Node 22/24; keep stderr clean for MCP hosts.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (/SQLite is an experimental feature/.test(text)) return;
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const [command = "mcp", ...args] = process.argv.slice(2);

// A long-lived MCP server mostly waits on I/O: size-optimized V8 saves ~10 MB RSS.
// Applied at runtime (no relaunch, so hosts see a single process).
if (command === "mcp") {
  const v8 = await import("node:v8");
  v8.setFlagsFromString("--optimize-for-size");
  v8.setFlagsFromString("--max-semi-space-size=1");
}

async function main() {
  switch (command) {
    case "mcp": {
      const { serve } = await import("./server.js");
      await serve();
      return;
    }
    case "doctor": {
      const { doctor } = await import("./domains/doctor.js");
      const project = args.find((a) => !a.startsWith("-"));
      process.stdout.write(JSON.stringify(await doctor({ project, remote: args.includes("--remote") }, new AbortController().signal), null, 2) + "\n");
      process.exit(0);
      return;
    }
    case "kb-build": {
      // deveco-mcp kb-build <upstream-knowledgebase-dir> [out-dir] [--version x] [--name @scope/pkg]
      const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
      const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
      const { buildKnowledgePack } = await import("./domains/kb-build.js");
      const upstream = positional[0];
      if (!upstream) throw new Error("usage: deveco-mcp kb-build <upstream-dir> [out-dir] [--version x] [--name @scope/pkg]");
      const result = await buildKnowledgePack({ upstream, out: positional[1] ?? "kb-dist", version: flag("--version"), npmName: flag("--name") });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }
    case "kb-update": {
      const { update } = await import("./domains/knowledge.js");
      process.stdout.write(JSON.stringify(await update({ source: args[0], force: args.includes("--force") }, new AbortController().signal), null, 2) + "\n");
      return;
    }
    case "--version":
    case "-v": {
      const { version } = await import("./core/config.js");
      process.stdout.write(version + "\n");
      return;
    }
    default:
      process.stderr.write("usage: deveco-mcp [mcp | doctor [project] | kb-build <dir> [out] | kb-update [file] | --version]\n");
      process.exit(2);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
