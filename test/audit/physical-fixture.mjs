// Prepare a newly created disposable project. Signing is supplied separately by its owner.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { makeCallChain, makeGesturePage, makeInterface, makeNative } from "../e2e/fixtures.mjs";

const root = process.argv[2];
assert.ok(root && path.isAbsolute(root), "Pass the absolute path of a new MCP test project");
const app = JSON5.parse(fs.readFileSync(path.join(root, "AppScope/app.json5"), "utf8")).app;
assert.match(app.bundleName, /^com\.devecomcp\./);
assert.ok(!fs.existsSync(path.join(root, "entry/src/main/ets/pages/Util.ets")), "Fixture already exists");
const file = path.join(root, "entry/src/main/ets/entryability/EntryAbility.ets");
const original = fs.readFileSync(file, "utf8");
const anchor = "  onWindowStageCreate(windowStage: window.WindowStage): void {";
assert.equal(original.split(anchor).length, 2, "Expected the SDK UIAbility template");
makeGesturePage(root);
makeCallChain(root);
makeInterface(root);
makeNative(root);
fs.writeFileSync(file, "import { relationalStore } from '@kit.ArkData';\n" + original.replace(anchor, `${anchor}
    relationalStore.getRdbStore(this.context, { name: 'audit.db', securityLevel: relationalStore.SecurityLevel.S1 }).then(async (store) => {
      await store.executeSql('CREATE TABLE IF NOT EXISTS proof (id INTEGER PRIMARY KEY, value TEXT)');
    });`));
console.log(JSON.stringify({ project: root, bundle: app.bundleName, fixture: "physical" }));
