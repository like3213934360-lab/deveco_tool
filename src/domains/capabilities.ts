import fs from "node:fs";
import path from "node:path";
import { inspectProject } from "./project.js";
import { toolchain, sdkInfo } from "../core/toolchain.js";
import { errorResult } from "../core/errors.js";
import { resourceStatus, coordinationDirectory } from "../core/operations.js";

/** Preflight facts are separate from execution evidence and unsupported platform features. */
export async function capabilities(projectPath: string | undefined, targets: string[], target?: string) {
  const matrix: Record<string, unknown>[] = [];
  const add = (action: string, status: "ready_for_attempt" | "blocked" | "unprobed" | "unsupported", reason: string, fix?: string) => matrix.push({ action, status, reason, fix, executed: false });
  let project, components;
  try { components = toolchain().components; } catch (e) { add("toolchain", "blocked", errorResult(e).message, "Configure DevEco Studio/CLT"); }
  try { if (projectPath) project = inspectProject(projectPath); } catch (e) { add("project", "blocked", errorResult(e).message); }
  add("project.verify", project ? "ready_for_attempt" : "blocked", "Requires a valid plan and new permanent output directory", "Pass project, plan and output");
  for (const [kind, directory] of [["local", "test"], ["instrument", "ohosTest"]]) {
    const sources = project?.modules.some((m) => fs.existsSync(path.join(m.root, `src/${directory}`)));
    const ready = !!components?.hvigor && sources && project?.product === "default" && (kind === "local" ? process.platform !== "linux" : target ? targets.includes(target) : targets.length === 1);
    add(`project.test:${kind}`, ready ? "ready_for_attempt" : "blocked", kind === "local" ? "SDK default product and test sources; macOS/Windows previewer" : "SDK default product, ohosTest sources, selected device via a job-scoped HDC channel; erases app data", kind === "instrument" ? "Use a dedicated app, explicit allow_data_reset=true and target; other devices may remain connected" : "Supply src/test on a supported SDK host");
  }
  add("device.selection", (target ? targets.includes(target) : targets.length === 1) ? "ready_for_attempt" : "blocked", `${targets.length} targets connected`, "Pass exact target when multiple devices are connected");
  for (const action of ["device.app", "device.file", "device.clipboard", "device.font", "device.screen", "device.system", "device.databases", "device.fixture", "device.scenario:permissions", "device.scenario:clear_data", "device.trace", "ui.perf"]) add(action, "unprobed", "Availability depends on selected device, debug package, privileges and returned evidence; never inferred from device presence");
  add("project.entries", project ? "ready_for_attempt" : "blocked", "Manifest/form configuration inspection only; not a lifecycle or host-rendering verdict");
  add("ui.form:desktop", "unprobed", "Bounded desktop inventory, system card center, owned attachment/removal and explicit matrix; recognized host controls required", "Probe inventory/catalog on the selected unlocked device; unknown host structures and size controls are unsupported");
  add("ui.form:disposable", "unprobed", "Matrix emulator cases require an explicitly selected installed device_type/os_version image and a buildable project; only owned instances are removed", "List installed images; no image download or license acceptance is automatic");
  for (const host of ["lockscreen", "assistant"]) add(`ui.form:${host}`, "unsupported", "No verified adapter for this host; desktop evidence does not establish support");
  add("ui.source", "unsupported", "UI dump lacks verified ArkTS source metadata", "code origin returns explicitly labelled static candidates");
  add("perf.source", "unsupported", "Composer FPS does not identify ArkTS calls", "device trace exports official raw events for analysis with matching debug metadata");
  add("scenario.http_mock", "unprobed", "Project-owned prepare/check/cleanup commands may expose test endpoints; no system proxy is installed", "Use reviewed verify commands with allow_commands=true");
  for (const action of ["form.standalone_host", "distributed.device_farm", "release.agc"]) add(action, "unsupported", "No implementation in this release");
  return { matrix, sdk: components ? sdkInfo() : undefined, coordination: { directory: coordinationDirectory(), resources: await resourceStatus(), scope: "same host, participating server processes; older MCP versions and external tools do not honor these locks", stale_owner: "Inspect side effects, then job release_resource; no automatic stealing" } };
}
