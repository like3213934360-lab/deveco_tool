// The opencode session (2026-09-30): phone + emulator connected, LingDong, project build with wait=600000,
// then build_run without target. Expected now: build runs (wait capped, noted); build_run without target
// refuses with the device list and asks to ask the user; with target=<phone name> it deploys to the phone.
import { evidence, mcp, record, waitJob, PROJECTS } from "./lib.mjs";
const c = await mcp({ shared: true });
const P = PROJECTS.lingdong;
const b = await c.call("project", { action: "build", project: P, wait: 600000, preflight: false });
const built = b.data.status === "running" ? await waitJob(c, b) : b.data;
const noTarget = await c.call("run", { action: "build_run", project: P, wait: 60000 });
const nt = noTarget.data.status === "running" ? await waitJob(c, noTarget) : noTarget.data;
const byName = await waitJob(c, await c.call("run", { action: "build_run", project: P, target: "HUAWEI Pura 80 Pro", wait: 60000 }));
await c.close();
const err = nt.error ?? nt;
const ev = evidence("claims", "opencode-scenario.json", { build: { status: built.status, notes: b.data.notes }, build_run_no_target: err, build_run_phone: { status: byName.status, device: byName.result?.device, modules: byName.result?.modules, launch: byName.result?.launch } });
record("C.opencode-wait", built.status === "succeeded" && (b.data.notes ?? []).some((n) => /capped/.test(n)) ? "VERIFIED" : "DEFECT", `LingDong project build wait=600000 -> ${built.status}; note: ${(b.data.notes ?? [])[0]}`, [ev]);
record("C.opencode-device-choice", err.code === "DEVICE_AMBIGUOUS" && err.details?.devices?.length === 2 && /ask the user/.test(err.hint) ? "VERIFIED" : "DEFECT", `build_run without target, 2 devices -> ${err.code}: ${(err.details?.devices ?? []).map((d) => `${d.name} (${d.emulator ? "emulator" : "real"}, matches ${d.matches_project})`).join("; ")}; hint: ${err.hint?.slice(0, 80)}`, [ev]);
record("C.opencode-deploy-phone", byName.status === "succeeded" && byName.result?.device === "4VF0225613017854" && byName.result?.launch?.started ? "VERIFIED" : "DEFECT", `build_run target='HUAWEI Pura 80 Pro' -> ${byName.status} on ${byName.result?.device}, modules ${JSON.stringify(byName.result?.modules)}, smoke ${byName.result?.launch?.smoke}`, [ev]);
