// device sqlite success path: a debug app that creates an RDB store, then query it (read) and refuse writes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidence, mcp, record, waitJob } from "./lib.mjs";
const EMU = "127.0.0.1:5555";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-sql-"));
const P = path.join(tmp, "App");
const c = await mcp();
await c.call("project", { action: "create", project: P, app_name: "Q", bundle_name: "com.devecomcp.sql", compatible_api: 24 });
const ab = path.join(P, "entry/src/main/ets/entryability/EntryAbility.ets");
let src = fs.readFileSync(ab, "utf8");
src = "import { relationalStore } from '@kit.ArkData';\n" + src.replace(/onWindowStageCreate\(windowStage: window.WindowStage\): void \{/, `onWindowStageCreate(windowStage: window.WindowStage): void {
    relationalStore.getRdbStore(this.context, { name: 'audit.db', securityLevel: relationalStore.SecurityLevel.S1 }).then(async (store) => {
      await store.executeSql('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT)');
      await store.executeSql("INSERT INTO t (name) VALUES ('alpha')");
    });`);
fs.writeFileSync(ab, src);
const br = await waitJob(c, await c.call("run", { action: "build_run", project: P, target: EMU, wait: 60000 }));
await new Promise((r) => setTimeout(r, 2000));
const q = await c.call("device", { action: "sqlite", target: EMU, bundle: "com.devecomcp.sql", db: "audit.db", sql: "select name from t" });
const w = await c.call("device", { action: "sqlite", target: EMU, bundle: "com.devecomcp.sql", db: "audit.db", sql: "delete from t" });
const ev = evidence("actions", "device.sqlite.success.json", { build_run: br.status, read: q.data, write_without_flag: w.data });
record("B.action.device.sqlite.success", !q.isError && JSON.stringify(q.data).includes("alpha") ? "VERIFIED" : "DEFECT", `read 'select name from t' -> ${JSON.stringify(q.data).slice(0, 140)}`, [ev]);
record("B.action.device.sqlite.readonly", w.isError ? "VERIFIED" : "DEFECT", `delete without write=true -> ${w.isError ? w.data.error.code : "executed"}`, [ev]);
await c.call("run", { action: "uninstall", project: P, target: EMU });
await c.close();
fs.rmSync(tmp, { recursive: true, force: true });
