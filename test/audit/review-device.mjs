// Review 1.3 (C): device faults - several devices without target, device gone mid-call, emulator boot races.
// Uses the local "Pura 90" emulator together with the phone; stops the emulator afterwards.
import { execFileSync } from "node:child_process";
import { evidence, mcp, record, PROJECTS } from "./lib.mjs";

const PHONE = process.env.AUDIT_TARGET ?? "6XE0225B06010966";
const P = PROJECTS.mystarring;
const H = "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc";
const ev = (n, d) => evidence("review-1.3", n, d);
const c = await mcp({ shared: true });
const call = async (tool, args) => { const t = Date.now(); const r = await c.call(tool, args); return { ...r, ms: Date.now() - t }; };
let emu;
try {
  const started = (await call("emulator", { action: "start", name: "Pura 90" })).data;
  emu = started.target;
  // 1. Several devices, no target: every device-bound tool must refuse and list them, never pick one.
  const results = {};
  for (const [name, tool, args] of [
    ["ui act", "ui", { action: "act", op: "key", key: "back" }],
    ["ui act steps", "ui", { action: "act", steps: [{ op: "key", key: "back" }] }],
    ["ui perf", "ui", { action: "perf" }],
    ["ui visual", "ui", { action: "visual", project: P, name: "x" }],
    ["ui layout", "ui", { action: "layout" }],
    ["run launch", "run", { action: "launch", project: P }],
    ["device log", "device", { action: "log", lines: 5 }],
  ]) {
    const r = await call(tool, args);
    results[name] = { error: r.data.error?.code, devices: r.data.error?.details?.devices?.length, ms: r.ms };
  }
  const bad = Object.entries(results).filter(([, r]) => r.error !== "DEVICE_AMBIGUOUS" || r.devices !== 2);
  record("F.dev.ambiguous-new-actions", bad.length === 0 ? "VERIFIED" : "DEFECT",
    `phone + emulator connected, no target: ${Object.entries(results).map(([k, r]) => `${k} -> ${r.error} (${r.devices} listed)`).join("; ")}`, [ev("dev-ambiguous.json", results)]);

  // build_run then_flow with 2 devices -> also ambiguous, before building.
  const br = await call("run", { action: "build_run", project: P, wait: 30000 });
  let st = br.data; while (st.status === "running") st = (await c.call("job", { action: "wait", job_id: st.job_id, wait: 30000 })).data;
  record("F.dev.ambiguous-build-run", (st.error?.code ?? br.data.error?.code) === "DEVICE_AMBIGUOUS" ? "VERIFIED" : "DEFECT",
    `build_run without target, 2 devices -> ${st.error?.code ?? br.data.error?.code} after ${br.ms} ms (step ${st.step ?? "-"})`, [ev("dev-ambiguous-build.json", st)]);

  // 2. Device disappears during a synchronous call: stop the emulator while a long ui assert polls it.
  const pending = call("ui", { action: "assert", target: emu, visible: { text: "不存在XYZ" }, timeout_ms: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  execFileSync(H, ["-t", emu, "shell", "reboot", "-p"]); // power off, like pulling the cable
  const gone = await pending;
  record("F.dev.gone-mid-call", gone.ms < 40000 && (gone.isError || gone.data.passed === false) ? "VERIFIED" : "DEFECT",
    `emulator powered off 3 s into ui assert (timeout 30 s): returned after ${gone.ms} ms with ${gone.isError ? `${gone.data.error?.code}: ${gone.data.error?.message?.slice(0, 120)}` : JSON.stringify(gone.data).slice(0, 120)}`, [ev("dev-gone.json", gone.data)],
    gone.isError ? {} : { severity: "medium", dimension: "availability" });
  const after = await call("ui", { action: "act", target: emu, op: "key", key: "back" });
  record("F.dev.gone-next-call", after.isError && /DEVICE|UNAVAILABLE|not connected/i.test(JSON.stringify(after.data)) ? "VERIFIED" : "DEFECT",
    `next call to the vanished device -> ${after.data.error?.code}: ${after.data.error?.message?.slice(0, 120)} (hint: ${after.data.error?.hint?.slice(0, 80) ?? "none"}) in ${after.ms} ms`, [ev("dev-gone-next.json", after.data)]);
} finally {
  await c.call("emulator", { action: "stop", name: "Pura 90" }).catch(() => {});
  await c.close();
}
