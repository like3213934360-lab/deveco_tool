// Upstream `build` always runs `ohpm install` first (and `hvigor --sync` when configs changed); ours
// syncs only when oh_modules is missing. Experiment: after a first build, add a local HAR dependency
// to entry/oh-package.json5 and import it, then build again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { evidence, mcp, record, waitJob } from "./lib.mjs";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "audit-sync-"));
const c = await mcp();
const root = path.join(work, "P");
await c.call("project", { action: "create", project: root, app_name: "S", bundle_name: "com.devecomcp.sync" });
const first = await waitJob(c, await c.call("project", { action: "build", project: root, preflight: false, wait: 60000 }));
// local HAR
const lib = path.join(root, "mylib");
fs.mkdirSync(path.join(lib, "src/main/ets"), { recursive: true });
fs.writeFileSync(path.join(lib, "src/main/module.json5"), JSON.stringify({ module: { name: "mylib", type: "har", deviceTypes: ["default"] } }));
fs.writeFileSync(path.join(lib, "src/main/ets/Hi.ets"), "export function hi(): string {\n  return 'hi';\n}\n");
fs.writeFileSync(path.join(lib, "Index.ets"), "export { hi } from './src/main/ets/Hi';\n");
fs.writeFileSync(path.join(lib, "oh-package.json5"), JSON.stringify({ name: "mylib", version: "1.0.0", main: "Index.ets" }));
fs.writeFileSync(path.join(lib, "build-profile.json5"), JSON.stringify({ apiType: "stageMode", buildOption: {}, targets: [{ name: "default" }] }));
fs.writeFileSync(path.join(lib, "hvigorfile.ts"), "import { harTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: harTasks, plugins: [] }\n");
const bp = path.join(root, "build-profile.json5"); const j = JSON5.parse(fs.readFileSync(bp, "utf8")); j.modules.push({ name: "mylib", srcPath: "./mylib" }); fs.writeFileSync(bp, JSON.stringify(j, null, 2));
const ep = path.join(root, "entry/oh-package.json5"); const e = JSON5.parse(fs.readFileSync(ep, "utf8")); e.dependencies = { ...(e.dependencies ?? {}), mylib: "file:../mylib" }; fs.writeFileSync(ep, JSON.stringify(e, null, 2));
const idx = path.join(root, "entry/src/main/ets/pages/Index.ets");
fs.writeFileSync(idx, "import { hi } from 'mylib';\n" + fs.readFileSync(idx, "utf8").replace("this.message = 'Welcome';", "this.message = hi();"));
const oh = fs.existsSync(path.join(root, "oh_modules"));
const second = await waitJob(c, await c.call("project", { action: "build", project: root, preflight: false, wait: 60000 }));
const msgs = (second.error?.details?.diagnostics ?? []).map((d) => d.message.slice(0, 160));
await c.close();
const ev = evidence("upstream", "build-after-dependency-change.json", { first: first.status, oh_modules_before_second: oh, second: second.status, error: second.error?.message, diagnostics: msgs, hints: second.error?.details?.hints });
record("A.upstream.build.ohpm-install", second.status === "succeeded" ? "VERIFIED" : "DEFECT",
  second.status === "succeeded" ? "adding a local dependency after the first build: second build succeeds without an explicit sync (hvigor resolves it)" : `adding a dependency after the first build (oh_modules already present): build ${second.status} — ${msgs.slice(0, 2).join(" | ")}; upstream runs 'ohpm install' before every build, ours only when oh_modules is missing`, [ev]);
fs.rmSync(work, { recursive: true, force: true });
