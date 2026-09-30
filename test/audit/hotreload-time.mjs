// hot_reload apply duration and effect on the emulator (3 edits, each verified on screen).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidence, mcp, record, waitJob } from "./lib.mjs";
const EMU = "127.0.0.1:5555";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-hr-"));
const P = path.join(tmp, "H");
const c = await mcp();
await c.call("project", { action: "create", project: P, app_name: "H", bundle_name: "com.devecomcp.hr", compatible_api: 24 });
await waitJob(c, await c.call("run", { action: "build_run", project: P, target: EMU, hot_reload: true, wait: 60000 }));
const F = path.join(P, "entry/src/main/ets/pages/Index.ets");
const rows = [];
let prev = "Hello World";
for (const next of ["Hello One", "Hello Two", "Hello Three"]) {
  fs.writeFileSync(F, fs.readFileSync(F, "utf8").replace(`'${prev}'`, `'${next}'`));
  const t = Date.now();
  const r = await c.call("hot_reload", { action: "apply", project: P, target: EMU, restart: true });
  const ms = Date.now() - t;
  const shown = (await c.call("ui", { action: "assert", target: EMU, visible: { text: next }, timeout_ms: 5000 })).data.passed;
  rows.push({ text: next, ms, ok: !r.isError, shown });
  prev = next;
}
await c.call("hot_reload", { action: "reset", project: P, target: EMU });
await c.call("run", { action: "uninstall", project: P, target: EMU });
await c.close();
fs.rmSync(tmp, { recursive: true, force: true });
const ev = evidence("agent-text", "hotreload-timing.json", rows);
record("D.text.36", rows.every((r) => r.ok && r.shown) ? (Math.max(...rows.map((r) => r.ms)) <= 6000 ? "VERIFIED" : "DEFECT") : "DEFECT", `SKILL.md '约 3 秒生效': apply+restart on emulator took ${rows.map((r) => (r.ms / 1000).toFixed(1) + "s").join(", ")}; new text on screen: ${rows.map((r) => r.shown).join(", ")}`, [ev]);
