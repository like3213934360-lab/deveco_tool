// HMS/OH kit resolution: hover by symbol name (server finds the position), require a real signature.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidence, mcp, record } from "./lib.mjs";
const c = await mcp();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-kit-"));
const P = path.join(tmp, "K");
await c.call("project", { action: "create", project: P, app_name: "K", bundle_name: "com.devecomcp.kit" });
const F = "entry/src/main/ets/pages/Kits.ets";
const kits = { "@kit.PushKit": ["pushService", "getToken"], "@kit.AccountKit": ["authentication", "HuaweiIDProvider"], "@kit.MapKit": ["map", "MapComponentController"], "@kit.ScanKit": ["scanBarcode", "startScanForResult"], "@kit.PaymentKit": ["paymentService", "requestPayment"], "@kit.StoreKit": ["productViewManager", "loadProduct"], "@kit.ArkUI": ["promptAction", "showToast"], "@kit.AbilityKit": ["abilityAccessCtrl", "createAtManager"] };
fs.writeFileSync(path.join(P, F), Object.entries(kits).map(([k, [ns]]) => `import { ${ns} } from '${k}';`).join("\n") + "\n" + Object.values(kits).map(([ns, m], i) => `export const v${i} = ${ns}.${m};`).join("\n") + "\n");
const rows = {};
for (const [k, [ns, m]] of Object.entries(kits)) {
  const h = (await c.call("code", { action: "lsp", op: "hover", project: P, file: F, symbol: `${ns}.${m}` })).data;
  rows[k] = { symbol: `${ns}.${m}`, hover: (h?.hover ?? "").replace(/\s+/g, " ").slice(0, 160), raw: h?.hover ? undefined : h };
}
const d = (await c.call("code", { action: "lsp", op: "diagnostics", project: P, file: F })).data;
await c.close();
const bad = Object.entries(rows).filter(([, r]) => !r.hover || /: any\b/.test(r.hover));
const ev = evidence("claims", "hms-kits-hover.json", { rows, diagnostics: d.diagnostics });
for (const [k, r] of Object.entries(rows)) console.log(k.padEnd(18), r.hover.slice(0, 110) || JSON.stringify(r.raw).slice(0, 110));
record("C.hms-kits-resolve", bad.length ? "DEFECT" : "VERIFIED", `hover by symbol on 8 kit members (6 HMS, 2 OH): ${8 - bad.length} real signatures, ${bad.length} missing/any (${bad.map(([k]) => k).join(", ")}); 'Cannot find module' diagnostics: ${(d.diagnostics ?? []).filter((x) => /Cannot find module/.test(x.message)).length}`, [ev]);
fs.rmSync(tmp, { recursive: true, force: true });
