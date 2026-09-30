// Minimal real emulator image run: install the wearable image (not downloaded before), verify it is
// listed as downloaded, remove it, verify it is gone. Raw Emulator output saved; success/failure
// classification compared with emulatorFailure(). Uses its own JSON-RPC client (no 120 s cap).
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { evidence, record, repo } from "./lib.mjs";

const DT = process.argv[2] ?? "wearable", OS = process.argv[3] ?? "HarmonyOS 7.0.0(26.0.0)";
const child = spawn(process.execPath, [path.join(repo, "dist/cli.js"), "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "", id = 0; const pending = new Map();
child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); } });
const rpc = (method, params) => new Promise((r) => { const cur = ++id; pending.set(cur, r); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: cur, method, params }) + "\n"); });
const call = async (name, args) => { const m = await rpc("tools/call", { name, arguments: args }); const t = m.result?.content?.find((c) => c.type === "text")?.text; return { isError: !!m.result?.isError, data: t ? JSON.parse(t) : m.error }; };
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "audit", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const downloaded = async () => (await call("emulator", { action: "images", device_type: DT })).data.images.some((e) => e.os_version === OS && e.downloaded);
const before = await downloaded();
if (before) { console.error(`${DT} ${OS} already downloaded; refusing to remove a user image`); process.exit(2); }
const t0 = Date.now();
const inst = await call("emulator", { action: "install_image", device_type: DT, os_version: OS });
const installMs = Date.now() - t0;
const afterInstall = await downloaded();
const rm = await call("emulator", { action: "remove_image", device_type: DT, os_version: OS });
const afterRemove = await downloaded();
const rm2 = await call("emulator", { action: "remove_image", device_type: DT, os_version: OS });
const bad = await call("emulator", { action: "install_image", device_type: DT, os_version: "HarmonyOS 0.0.0(1)" });
child.stdin.end();
const ev = evidence("real-emulator", "run.json", { device_type: DT, os: OS, before, install: inst, install_ms: installMs, afterInstall, remove: rm, afterRemove, remove_again: rm2, install_bad_version: bad });
record("B.real-emulator.install", !inst.isError && afterInstall === true ? "VERIFIED" : "DEFECT", `install_image ${DT} '${OS}': ${inst.isError ? `${inst.data.error.code}: ${inst.data.error.message.slice(0, 160)}` : "success"} in ${Math.round(installMs / 1000)} s; listed as downloaded afterwards: ${afterInstall}`, [ev]);
record("B.real-emulator.install-output", !inst.isError && inst.data.bytes > 0 && inst.data.output.length < 700 ? "VERIFIED" : "DEFECT", `install_image result: ${JSON.stringify(inst.data).slice(0, 300)}`, [ev]);
record("B.real-emulator.remove", !rm.isError && afterRemove === false ? "VERIFIED" : "DEFECT", `remove_image: ${rm.isError ? rm.data.error.code : "success"}; still downloaded afterwards: ${afterRemove}`, [ev]);
record("B.real-emulator.remove-missing", rm2.isError && rm2.data.error.code === "NOT_FOUND" ? "VERIFIED" : "DEFECT", `remove_image again (already removed): ${rm2.isError ? `${rm2.data.error.code}: ${rm2.data.error.message.slice(0, 120)}` : `reported success: ${JSON.stringify(rm2.data).slice(0, 120)}`}`, [ev]);
record("B.real-emulator.install-bad-version", bad.isError ? "VERIFIED" : "DEFECT", `install_image with a non-existent OS version: ${bad.isError ? `${bad.data.error.code}: ${bad.data.error.message.slice(0, 160)}` : `reported success: ${JSON.stringify(bad.data).slice(0, 160)}`}`, [ev]);
record("C.emulator-failure-detection", !inst.isError && afterInstall && bad.isError && rm2.isError ? "VERIFIED" : "DEFECT", "real outputs: successful install/remove not misread as failure; bad version and double remove detected (exit code 0 in both cases)", [ev]);
