// arkts-check vs the compiler on every authorised project.
// 1) run the vendored checker (whole project, full untruncated result)
// 2) build every HAP module with hvigor through the MCP (compiler of record)
// 3) every checker error is classified with the compiler's own evidence:
//    - build failed with a diagnostic on the same file:line  -> confirmed
//    - build succeeded and the file was compiled             -> false positive
//    - file not part of the compiled graph                   -> not falsifiable by the build (reported separately)
// "Compiled" = the file appears in hvigor's intermediates (loader_out / ets cache) after the build.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { COPIES, PROJECTS, evidence, mcp, record, waitJob } from "./lib.mjs";

const C = "/Applications/DevEco-Studio.app/Contents";
const only = process.argv[2];
const c = await mcp();
const summary = {};
for (const [key, root] of Object.entries({ ...PROJECTS, ...COPIES })) {
  if (only && key !== only) continue;
  let check;
  try {
    const out = execFileSync(`${C}/tools/node/bin/node`, ["--max-old-space-size=4096", path.join(process.cwd(), "resources/vendor/arkts-check.cjs"), "--project", root],
      { env: { ...process.env, DEVECO_HOME: C }, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString();
    check = JSON.parse(out);
  } catch (e) {
    const out = e.stdout?.toString() ?? "";
    try { check = JSON.parse(out); } catch { check = { success: false, error: `checker crashed: ${String(e.message).slice(0, 200)}`, errors: [] }; }
  }
  const errors = (check.errors ?? []).filter((d) => d.severity === "error");
  const t = Date.now();
  const b = await waitJob(c, await c.call("project", { action: "build", project: root, preflight: false, wait: 60000 }));
  // HAR/HSP modules that no entry imports are not compiled by assembleHap: build them too.
  const info = (await c.call("project", { action: "info", project: root })).data;
  const harBuilds = [];
  for (const [task, type] of [["assembleHar", "har"], ["assembleHsp", "shared"]]) {
    if (!(info.modules ?? []).some((m) => m.type === type)) continue;
    const r = await waitJob(c, await c.call("project", { action: "build", project: root, task, preflight: false, wait: 60000 }));
    harBuilds.push({ task, status: r?.status, error: r?.error?.message, diagnostics: (r?.error?.details?.diagnostics ?? []).slice(0, 20) });
    if (r?.status === "failed") (b.error ??= { details: { diagnostics: [] } }).details.diagnostics.push(...(r.error?.details?.diagnostics ?? []));
  }
  // ArkTS compilation is what the checker predicts: a build that fails only at packaging/signing
  // (e.g. :SignHap, 00303107 missing signingConfig) still compiled every source successfully.
  const failedTask = /Failed :[\w-]+:\w+@(\w+)/.exec(JSON.stringify(b?.error?.details?.diagnostics ?? []))?.[1];
  const compileOk = b?.status === "succeeded" || (!!failedTask && !/Compile|ArkTS|PreBuild|Syscap/i.test(failedTask));
  const buildOk = compileOk;
  const buildDiags = b?.error?.details?.diagnostics ?? [];
  // compiled file set: hvigor's CompileArkTS cache mirrors every compiled source as
  // build/<product>/cache/<target>/<target>@CompileArkTS/esmodule/<mode>/<pkg path>/src/main/ets/<file>.ts
  const compiled = new Set();
  const walk = (dir, depth = 0) => {
    if (depth > 16) return;
    let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "oh_modules" && e.name !== "node_modules" && e.name !== ".git") walk(f, depth + 1); }
      else if (/@CompileArkTS[\\/]esmodule[\\/]/.test(f) && /\.ts$/.test(e.name)) {
        const m = /@CompileArkTS[\\/]esmodule[\\/][^\\/]+[\\/](.+)\.ts$/.exec(f);
        if (m) compiled.add(m[1].split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  const rows = errors.map((d) => {
    const inBuildDiag = buildDiags.some((x) => x.file && d.file.endsWith(x.file.replace(/^.*?src\/main\/ets\//, "")) && x.line === d.line);
    // cache paths are "<module dir or pkg name>/src/main/ets/x" — match on the src/main/ets tail plus module dir name
    const rel = d.file.split(path.sep).join("/").replace(/\.ets$/, "");
    const wasCompiled = [...compiled].some((p) => p.endsWith(rel) || rel.endsWith(p.split("/src/main/ets/")[1] ? "src/main/ets/" + p.split("/src/main/ets/")[1] : "\u0000") && p.split("/src/main/ets/")[0].split("/").pop() === rel.split("/src/main/ets/")[0].split("/").pop());
    const cls = !buildOk ? (inBuildDiag ? "confirmed" : "build-failed-elsewhere") : wasCompiled ? "false-positive" : "not-compiled";
    return { rule: d.rule ?? d.code ?? "tsc", file: d.file, line: d.line, message: d.message.slice(0, 200), cls };
  });
  const count = (k) => rows.filter((r) => r.cls === k).length;
  summary[key] = { checker_errors: errors.length, checker_warnings: (check.errors ?? []).length - errors.length, checker_error: check.error ?? null,
    build: b?.status, failed_task: failedTask ?? null, compile_ok: compileOk, build_ms: Date.now() - t, build_errors: buildDiags.length, compiled_files: compiled.size,
    false_positive: count("false-positive"), confirmed: count("confirmed"), not_compiled: count("not-compiled"), build_failed_elsewhere: count("build-failed-elsewhere"),
    by_rule: rows.reduce((a, r) => ((a[`${r.rule}:${r.cls}`] = (a[`${r.rule}:${r.cls}`] ?? 0) + 1), a), {}) };
  const ev = evidence("check-rules", `project-${key}.json`, { summary: summary[key], har_builds: harBuilds, rows, build_diagnostics: buildDiags.slice(0, 50), build_error: b?.error?.message ?? null });
  const s = summary[key];
  const verdict = s.checker_error ? "DEFECT" : s.false_positive ? "DEFECT" : s.build !== "succeeded" && s.build_failed_elsewhere ? "UNVERIFIED" : s.not_compiled ? "UNVERIFIED" : "VERIFIED";
  record(`B.code.check.project.${key}`, verdict,
    `checker ${s.checker_errors} errors (${s.false_positive} false-positive on compiled files, ${s.confirmed} confirmed by build, ${s.not_compiled} in files the build did not compile, ${s.build_failed_elsewhere} unmatched while build failed); build ${s.build}${s.build_errors ? ` with ${s.build_errors} errors` : ""}${s.checker_error ? `; checker error: ${s.checker_error}` : ""}`, [ev], { summary: s });
}
await c.close();
console.log(JSON.stringify(summary, null, 1));
