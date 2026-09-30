// Re-checks for the upstream-parity fixes: uninstall classification, layout depth, atomcode/dsh
// skills, ui_flow stop project, emulator images list.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidence, mcp, record, waitJob } from "./lib.mjs";
const EMU = "127.0.0.1:5555";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-upfix-"));
const c = await mcp();
const P = path.join(tmp, "U");
await c.call("project", { action: "create", project: P, app_name: "U", bundle_name: "com.devecomcp.upfix", compatible_api: 24 });
await waitJob(c, await c.call("run", { action: "build_run", project: P, target: EMU, wait: 60000 }));
// uninstall: installed -> true; again -> not_installed
const u1 = (await c.call("run", { action: "uninstall", project: P, target: EMU })).data;
const u2 = (await c.call("run", { action: "uninstall", project: P, target: EMU })).data;
record("A.upstream.run.uninstall", u1.uninstalled === true && u2.uninstalled === false && u2.reason === "not_installed" ? "VERIFIED" : "DEFECT",
  `installed -> ${JSON.stringify(u1)}; not installed -> ${JSON.stringify(u2)}; other failures now raise UNINSTALL_FAILED (like devecocli)`, [evidence("upstream", "uninstall-fixed.json", { u1, u2 })]);
// depth
const count = async (depth) => { const r = (await c.call("ui", { action: "tree", target: EMU, interactive: false, limit: 2000, ...(depth === undefined ? {} : { depth }) })).data; return r.tree.split("\n").filter(Boolean).length; };
const d = { omitted: await count(undefined), d0: await count(0), d1: await count(1), d2: await count(2) };
record("A.upstream.ui.layout-depth", d.d0 === d.omitted && d.d1 === 1 && d.d2 > d.d1 && d.d2 < d.omitted ? "VERIFIED" : "DEFECT", `lines: omitted ${d.omitted}, depth=0 ${d.d0} (unlimited), depth=1 ${d.d1} (root only), depth=2 ${d.d2} (root+children)`, [evidence("upstream", "ui-depth-fixed.json", d)]);
// skills atomcode/dsh
const sk = {};
for (const host of ["atomcode", "dsh"]) {
  const r = await c.call("skills", { action: "export", host, scope: "project", project: P });
  sk[host] = r.isError ? r.data.error.message : r.data.directory;
}
record("A.upstream.skills.agents", sk.atomcode === path.join(P, ".atomcode/skills") && sk.dsh === path.join(P, ".dsh/skills") ? "VERIFIED" : "DEFECT", `project export: atomcode -> ${sk.atomcode}, dsh -> ${sk.dsh} (upstream AGENT_SKILLS_CONFIG / getProjectAgentSkillsDir)`, [evidence("upstream", "skills-agents-fixed.json", sk)]);
// ui_flow stop with another project
await c.call("run", { action: "launch", project: P, target: EMU });
await c.call("ui_flow", { action: "record", project: P, target: EMU, id: "f1" });
const wrong = await c.call("ui_flow", { action: "stop", project: path.join(tmp, "Other"), target: EMU, assert: { visible: { text: "Hello World" } } });
const again = await c.call("ui_flow", { action: "record", project: P, target: EMU, id: "f2" });
await c.call("ui_flow", { action: "stop", project: P, target: EMU, discard: true });
record("B.action.ui_flow.stop.project-ignored", wrong.isError && /belongs to/.test(wrong.data.error.message) && again.isError && again.data.error.details?.project ? "VERIFIED" : "DEFECT",
  `stop with a different project -> ${wrong.isError ? wrong.data.error.code + ": " + wrong.data.error.message.slice(0, 90) : "saved"}; second record while one is open -> ${again.data.error?.code} with details ${JSON.stringify(again.data.error?.details ?? {}).slice(0, 120)}`, [evidence("actions", "ui_flow-stop-fixed.json", { wrong: wrong.data, again: again.data })]);
// images
const im = (await c.call("emulator", { action: "images", device_type: "wearable" })).data;
record("B.emulator.images-empty", Array.isArray(im.images) && im.images.length === 0 ? "VERIFIED" : "DEFECT", `no downloaded wearable image -> ${JSON.stringify(im).slice(0, 100)}`, [evidence("upstream", "images-empty-fixed.json", im)]);
const all = (await c.call("emulator", { action: "images" })).data;
record("A.upstream.emulator.image-list", all.images?.length > 0 && all.images.every((x) => x.device_type && x.os_version) ? "VERIFIED" : "DEFECT", `images parsed into rows (like upstream): ${all.images?.length} downloaded, e.g. ${JSON.stringify(all.images?.[0])}`, [evidence("upstream", "images-rows.json", all)]);
await c.close();
fs.rmSync(tmp, { recursive: true, force: true });
