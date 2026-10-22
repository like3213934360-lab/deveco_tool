#!/usr/bin/env node
/* Entry: `deveco-mcp [mcp]` serves stdio; `doctor` and `kb-build` are local helpers. */

// Direct generation entry points lease too, before any lazy import can observe a retired build.
declare const __DEVECO_BUILD__: { generation?: string };
if (typeof __DEVECO_BUILD__ !== "undefined" && __DEVECO_BUILD__.generation) {
  const { fileURLToPath } = await import("node:url");
  const runtime = await import(new URL("../../../bin/runtime.mjs", import.meta.url).href);
  await runtime.useGeneration(fileURLToPath(new URL("../../../", import.meta.url)), `${__DEVECO_BUILD__.generation}/cli.js`);
}

// node:sqlite prints an ExperimentalWarning on Node 22/24; keep stderr clean for MCP hosts.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (/SQLite is an experimental feature/.test(text)) return;
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const [command = "mcp", ...args] = process.argv.slice(2);

// Honour HTTPS_PROXY / HTTP_PROXY / NO_PROXY for every outbound request (login, CodeGenie, AGC, skill
// market, knowledge updates), like devecocli does since deveco-code c68ca36d2. Node's fetch ignores
// these variables unless told; setGlobalProxyFromEnv (Node >= 24) enables it for this process.
if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
  const http = (await import("node:http")) as { setGlobalProxyFromEnv?: () => unknown };
  try { http.setGlobalProxyFromEnv?.(); } catch { /* older Node: direct connections */ }
}

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
    case "verify": {
      const values = new Set(["--project", "--plan", "--out", "--target", "--base", "--baseline-mode"]);
      const flags = new Set(["--changed-only", "--allow-commands"]);
      const parsed: Record<string, string> = {};
      for (let i = 0; i < args.length; i++) {
        const key = args[i]!;
        if (values.has(key) && args[i + 1] && !args[i + 1]!.startsWith("--")) parsed[key] = args[++i]!;
        else if (!flags.has(key)) throw new Error(`Unknown or incomplete verify argument: ${key}`);
      }
      if (!parsed["--project"] || !parsed["--plan"] || !parsed["--out"]) throw new Error("verify --project <absolute path> --plan <file> --out <new absolute directory> [--target id] [--changed-only --base ref] [--baseline-mode compare|record] [--allow-commands]");
      const { invokeTool } = await import("./server.js");
      const { waitJob, cancelJob } = await import("./core/jobs.js");
      const signal = new AbortController();
      let result: any = await invokeTool("project", { action: "verify", project: parsed["--project"], plan: parsed["--plan"], output: parsed["--out"], target: parsed["--target"], base: parsed["--base"], baseline_mode: parsed["--baseline-mode"], changed_only: args.includes("--changed-only"), allow_commands: args.includes("--allow-commands"), wait: 0 }, signal.signal);
      for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { void cancelJob(result.job_id); });
      while (["running", "queued"].includes(result.status)) result = await waitJob(result.job_id, 1000);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exit(result.status === "succeeded" && result.result?.verdict === "passed" ? 0 : 1);
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
    case "init": {
      // deveco-mcp init --host cursor [--project <path>] [--force] [--skills-only|--mcp-only]
      const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
      const host = flag("--host");
      if (!host) throw new Error("usage: deveco-mcp init --host <cursor|claude|codex|opencode|trae-cn|codebuddy|qoder|pi> [--project <path>] [--path <skills dir>] [--force] [--skills-only|--mcp-only]");
      const { initHost } = await import("./domains/skills.js");
      const project = flag("--project");
      process.stdout.write(JSON.stringify(await initHost(host, {
        project, scope: project ? "project" : "user", force: args.includes("--force"), dir: flag("--path"),
        skills: !args.includes("--mcp-only"), mcp: !args.includes("--skills-only"),
      }), null, 2) + "\n");
      return;
    }
    case "serve-lsp": {
      // Editor-facing LSP: stdio passthrough to the SDK ArkTS server (or clangd with --cpp).
      const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
      const { lspCommand } = await import("./domains/code.js");
      const { spawn } = await import("node:child_process");
      // --auto-detect: without --project, search the cwd and its subdirectories (never upward) for a project root.
      let project = flag("--project") ?? flag("--project-path");
      if (!project && args.includes("--auto-detect")) {
        const { findProjectRoot } = await import("./domains/project.js");
        project = findProjectRoot(process.cwd());
        if (!project) throw new Error("serve-lsp --auto-detect: no HarmonyOS project (build-profile.json5 + AppScope) under the current directory");
      }
      const cmd = lspCommand(project ?? process.cwd(), args.includes("--cpp") ? "cpp" : "arkts");
      const child = spawn(cmd.file, cmd.args, { cwd: cmd.cwd, env: cmd.env as NodeJS.ProcessEnv, stdio: ["pipe", "inherit", "inherit"] });
      for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
      // The SDK ArkTS server ignores the LSP `exit` notification: enforce it (and editor disconnects).
      const stop = () => setTimeout(() => child.kill("SIGTERM"), 1000).unref();
      process.stdin.on("data", (chunk: Buffer) => {
        child.stdin!.write(chunk);
        if (/"method"\s*:\s*"exit"/.test(chunk.toString("utf8"))) stop();
      });
      process.stdin.on("end", () => { child.stdin!.end(); stop(); });
      child.on("exit", (code) => process.exit(code ?? 0)); // stdin listeners would otherwise keep us alive
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
      process.stderr.write("usage: deveco-mcp [mcp | verify --project <path> --plan <file> --out <directory> | doctor [project] | init --host <host> | serve-lsp [--cpp] [--project p | --auto-detect] | kb-build <dir> [out] | kb-update [file] | --version]\n");
      process.exit(2);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
