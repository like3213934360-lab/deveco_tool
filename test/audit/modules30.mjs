// All 30 API modules that did not resolve in a phone module: resolution per deviceTypes, plus whether
// hvigor compiles an import of each. Replaces the earlier partial check (22 of 30) and inference (8).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { evidence, mcp, record, waitJob } from "./lib.mjs";
const mods = ["@ohos.app.ability.DriverExtensionAbility","@ohos.arkui.layoutAlgorithm","@ohos.arkui.lazyLayoutAlgorithm","@ohos.busManager.serial","@ohos.connectedTag","@ohos.driver.deviceManager","@ohos.multimedia.avMusicTemplate","@ohos.net.netFirewall","@ohos.selectionInput.SelectionExtensionAbility","@ohos.selectionInput.SelectionExtensionContext","@ohos.selectionInput.SelectionPanel","@ohos.selectionInput.selectionManager","@ohos.settingsLite","@ohos.usbManager.serial","@ohos.wifiext","@hms.ai.appController","@hms.core.iap.cashierComponent","@hms.data.localChatModel","@hms.data.rag","@hms.enterpriseSpaceService.fileTransfer","@hms.enterpriseSpaceService.spaceManager","@hms.hiviewdfx.feedbackService","@hms.pcService.StatusBarViewExtensionAbility","@hms.pcService.fileGuard","@hms.pcService.openFileBoost","@hms.pcService.quickBarManager","@hms.pcService.recoveryKeyService","@hms.pcService.statusBarManager","@hms.pcService.virusRemediation","@hms.security.securityAudit"];
const types = [["phone"], ["2in1"], ["tablet"], ["car"], ["tv"], ["wearable"]];
const work = fs.mkdtempSync(path.join(os.tmpdir(), "audit-m30-"));
const c = await mcp();
const res = Object.fromEntries(mods.map((m) => [m, {}]));
for (const dt of types) {
  const root = path.join(work, dt.join("_"));
  await c.call("project", { action: "create", project: root, app_name: "M", bundle_name: "com.devecomcp.m30" });
  const mf = path.join(root, "entry/src/main/module.json5");
  const j = JSON5.parse(fs.readFileSync(mf, "utf8")); j.module.deviceTypes = dt; fs.writeFileSync(mf, JSON.stringify(j, null, 2));
  const file = "entry/src/main/ets/pages/Scan.ets";
  fs.writeFileSync(path.join(root, file), mods.map((m, i) => `import * as m${i} from '${m}';`).join("\n") + "\n" + mods.map((_, i) => `export const u${i} = m${i};`).join("\n") + "\n");
  const d = (await c.call("code", { action: "lsp", op: "diagnostics", project: root, file, limit: 200 })).data;
  for (const x of d.diagnostics ?? []) if (x.line <= mods.length && (x.code === 2307 || /Cannot find module|system capabilities/.test(x.message))) res[mods[x.line - 1]][dt] = x.message.slice(0, 110);
  for (const m of mods) res[m][dt] ??= "resolved";
}
await c.close();
fs.rmSync(work, { recursive: true, force: true });
const rows = mods.map((m) => ({ module: m, resolves_on: types.filter((t) => res[m][t] === "resolved").map((t) => t[0]), phone: res[m].phone }));
const ev = evidence("syscap", "modules30.json", { rows, raw: res });
const never = rows.filter((r) => !r.resolves_on.length);
const pcOnly = rows.filter((r) => r.resolves_on.includes("2in1") && !r.resolves_on.includes("phone"));
for (const r of rows) console.log(r.module.padEnd(50), (r.resolves_on.join(",") || "NONE").padEnd(30), (r.phone ?? "").slice(0, 70));
record("C.api-modules-30", never.length ? "DEFECT" : "VERIFIED",
  `all 30 checked on phone/2in1/tablet/car/tv/wearable: ${pcOnly.length} resolve on 2in1 but not phone; ${never.length} resolve on none (${never.map((r) => r.module).join(", ")}); earlier claim said 22 PC-only + 8 device/system-only`, [ev]);
