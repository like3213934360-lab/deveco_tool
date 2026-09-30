// Re-verification of earlier statements (claims.json) that tools-actions did not already cover.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROJECTS, evidence, mcp, record, waitJob } from "./lib.mjs";

const PHONE = "4VF0225613017854", EMU = "127.0.0.1:5555";
const c = await mcp({ shared: true });

// multi-device-select: LingDong phone build_run only builds phone module
{
  const r = await waitJob(c, await c.call("run", { action: "build_run", project: PROJECTS.lingdong, target: PHONE, wait: 60000 }));
  const mods = r.result?.modules ?? r.result?.build?.modules ?? [];
  const ev = evidence("claims", "multi-device-select.json", { status: r.status, step: r.step, modules: mods, launch: r.result?.launch, error: r.error });
  record("C.multi-device-select", r.status === "succeeded" && JSON.stringify(mods).includes("default") && !JSON.stringify(mods).includes("watch") ? "VERIFIED" : "DEFECT",
    `LingDong build_run on phone: ${r.status}; modules ${JSON.stringify(mods)}; launch ${JSON.stringify(r.result?.launch ?? {}).slice(0, 100)}`, [ev]);
}
// hms-kits-resolve: hover on HMS kit symbols in LingDong
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-kit-"));
  const P = path.join(tmp, "K");
  await c.call("project", { action: "create", project: P, app_name: "K", bundle_name: "com.devecomcp.kit" });
  const F = "entry/src/main/ets/pages/Kits.ets";
  const kits = { "@kit.PushKit": "pushService", "@kit.AccountKit": "authentication", "@kit.MapKit": "map", "@kit.ScanKit": "scanBarcode", "@kit.PaymentKit": "paymentService", "@kit.UIDesignKit": "HdsNavigation", "@kit.ArkUI": "promptAction", "@kit.AbilityKit": "common" };
  fs.writeFileSync(path.join(P, F), Object.entries(kits).map(([k, s]) => `import { ${s} } from '${k}';`).join("\n") + "\n" + Object.values(kits).map((s, i) => `export const v${i} = ${s};`).join("\n") + "\n");
  const rows = {};
  let i = 0;
  for (const [k, s] of Object.entries(kits)) {
    const line = Object.keys(kits).length + 1 + i++;
    const h = (await c.call("code", { action: "lsp", op: "hover", project: P, file: F, line, column: 18 })).data;
    rows[k] = (h?.hover ?? JSON.stringify(h)).replace(/\s+/g, " ").slice(0, 120);
  }
  const d = (await c.call("code", { action: "lsp", op: "diagnostics", project: P, file: F })).data;
  const bad = Object.values(rows).filter((v) => /: any\b|^\s*$|No hover/.test(v));
  const ev = evidence("claims", "hms-kits-hover.json", { rows, diagnostics: d.diagnostics });
  record("C.hms-kits-resolve", !bad.length && !(d.diagnostics ?? []).some((x) => /Cannot find module/.test(x.message)) ? "VERIFIED" : "DEFECT",
    `8 kits (6 HMS + 2 OH) hovers: ${bad.length} unresolved; diagnostics 'Cannot find module': ${(d.diagnostics ?? []).filter((x) => /Cannot find module/.test(x.message)).length}`, [ev]);
  fs.rmSync(tmp, { recursive: true, force: true });
}
// push-token-signature: SDK source line
{
  const f = "/Applications/DevEco-Studio.app/Contents/sdk/default/hms/ets/api/@hms.core.push.pushService.d.ts";
  const s = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const i = s.indexOf("function on(type: 'tokenUpdate'");
  const block = i > 0 ? s.slice(s.lastIndexOf("/**", i), s.indexOf("\n", i)) : "";
  const ev = evidence("claims", "push-token-signature.txt", block || `not found in ${f}`);
  record("C.push-token-signature", /ability/i.test(block) && /@since 5\.1\.0\(18\)/.test(block) ? "VERIFIED" : "DEFECT", `SDK: ${block.split("\n").filter((l) => /@since|function on|@syscap/.test(l)).map((l) => l.trim()).join(" | ").slice(0, 200)}`, [ev]);
}
// local-kb-complete: page through a long doc
{
  const s = (await c.call("knowledge", { action: "search", query: "Navigation 组件导航 NavPathStack", kind: "docs", limit: 3 })).data.results;
  let best = { id: null, chars: 0, pages: 0, total: 0 };
  for (const r of s) {
    let text = "", offset = 0, pages = 0, total;
    for (;;) { const p = (await c.call("knowledge", { action: "read", id: r.id, offset })).data; text += p.content; pages++; total = p.total_chars ?? total; if (!p.next) break; offset = p.next.offset; }
    if (text.length > best.chars) best = { id: r.id, chars: text.length, pages, total };
  }
  const ev = evidence("claims", "kb-paging.json", best);
  record("C.local-kb-complete", best.pages > 1 && (!best.total || best.total === best.chars) ? "VERIFIED" : "UNVERIFIED", `longest of top 3 Navigation docs: ${best.chars} chars in ${best.pages} pages (reported total ${best.total ?? "n/a"})`, [ev]);
}
// input-quotes on emulator: type into a TextInput and read back
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-q-"));
  const P = path.join(tmp, "Q");
  await c.call("project", { action: "create", project: P, app_name: "Q", bundle_name: "com.devecomcp.quotes", compatible_api: 24 });
  fs.writeFileSync(path.join(P, "entry/src/main/ets/pages/Index.ets"), "@Entry\n@Component\nstruct Index {\n  @State v: string = ''\n  build() {\n    Column() {\n      TextInput({ text: this.v }).id('in').onChange((s: string) => { this.v = s })\n      Text(`[${this.v}]`).id('out')\n    }\n  }\n}\n");
  await waitJob(c, await c.call("run", { action: "build_run", project: P, target: EMU, wait: 60000 }));
  const text = `it's "q" $HOME \`x\` & | ; 中文`;
  await c.call("ui", { action: "act", target: EMU, op: "input", selector: { id: "in" }, text });
  await new Promise((r) => setTimeout(r, 800));
  const out = (await c.call("ui", { action: "find", target: EMU, selector: { id: "out" } })).data.matches?.[0]?.text;
  const ev = evidence("claims", "input-quotes.json", { sent: text, shown: out });
  record("C.input-quotes", out === `[${text}]` ? "VERIFIED" : "DEFECT", `sent ${JSON.stringify(text)} -> shown ${JSON.stringify(out)}`, [ev]);
  await c.call("run", { action: "uninstall", project: P, target: EMU });
  fs.rmSync(tmp, { recursive: true, force: true });
}
await c.close();

// job-orphan-resume: kill the server while a build runs, new server sees interrupted, resume succeeds
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-orphan-"));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "audit-orphan-state-"));
  const { connect } = await import("../../tools/mcp-client.mjs");
  const a = connect({ DEVECO_STATE_DIR: state }); await a.initialize();
  const P = path.join(tmp, "O");
  await a.call("project", { action: "create", project: P, app_name: "O", bundle_name: "com.devecomcp.orphan" });
  const j = (await a.call("project", { action: "build", project: P, clean: true, wait: 0 })).data;
  await new Promise((r) => setTimeout(r, 1500));
  a.child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
  const b = connect({ DEVECO_STATE_DIR: state }); await b.initialize();
  const s1 = (await b.call("job", { action: "status", job_id: j.job_id })).data;
  const r = await b.call("job", { action: "resume", job_id: j.job_id, wait: 60000 });
  const s2 = r.data.status === "running" ? (await b.call("job", { action: "wait", job_id: j.job_id, wait: 120000 })).data : r.data;
  await b.close();
  const ev = evidence("claims", "job-orphan.json", { after_kill: s1.status, resumed: s2.status });
  record("C.job-orphan-resume", s1.status === "interrupted" && s2.status === "succeeded" ? "VERIFIED" : "DEFECT", `server SIGKILLed mid-build: new server reads ${s1.status}; resume -> ${s2.status}`, [ev]);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(state, { recursive: true, force: true });
}
// daemon-recovery: kill the ace-server child, next lsp call recovers
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-lspkill-"));
  const { connect } = await import("../../tools/mcp-client.mjs");
  const a = connect(); await a.initialize();
  const P = path.join(tmp, "L");
  await a.call("project", { action: "create", project: P, app_name: "L", bundle_name: "com.devecomcp.lspkill" });
  const F = "entry/src/main/ets/pages/Index.ets";
  const h1 = (await a.call("code", { action: "lsp", op: "symbols", project: P, file: F })).data;
  const kids = (await import("node:child_process")).execSync(`pgrep -P ${a.child.pid} || true`).toString().trim().split("\n").filter(Boolean);
  for (const k of kids) try { process.kill(Number(k), "SIGKILL"); } catch {}
  await new Promise((r) => setTimeout(r, 800));
  const h2 = await a.call("code", { action: "lsp", op: "symbols", project: P, file: F });
  const chk = await a.call("code", { action: "check", project: P });
  await a.close();
  const ev = evidence("claims", "daemon-recovery.json", { killed: kids.length, before: JSON.stringify(h1).slice(0, 200), after: h2.data, check_after: chk.data });
  record("C.daemon-recovery", kids.length && !h2.isError && !chk.isError ? "VERIFIED" : kids.length ? "DEFECT" : "UNVERIFIED", `killed ${kids.length} child process(es) of the server; next lsp symbols ${h2.isError ? "failed: " + h2.data.error.message.slice(0, 80) : "ok"}; check ${chk.isError ? "failed" : "ok"}`, [ev]);
  fs.rmSync(tmp, { recursive: true, force: true });
}
