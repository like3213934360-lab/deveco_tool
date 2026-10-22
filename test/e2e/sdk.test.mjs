// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { test } from "node:test";
import { app, session } from "../support/acceptance.mjs";

test("sdk", async (t) => {
  const { call, job, directory, project, bundle, file, lsp } = await app(t, false);

  await t.test("project.info-sync-build", async () => {
    assert.equal((await call("project", { action: "info", project })).bundle_name, bundle);
    await job("project", { action: "sync", project, wait: 0 });
    const built = await job("project", { action: "build", project, wait: 0 });
    assert.ok(built.result.artifacts.some((a) => a.path.endsWith("-signed.hap") && fs.statSync(a.path).size > 0));
    fs.writeFileSync(path.join(directory, "build.json"), JSON.stringify(built, null, 2));
    const status = await call("job", { action: "status", job_id: built.job_id, detail: true });
    assert.equal(status.status, "succeeded");
    assert.ok((await call("job", { action: "list", limit: 100 })).jobs.some((j) => j.job_id === built.job_id));
    const log = await call("job", { action: "read", artifact_id: built.result.log_artifact, grep: "BUILD SUCCESSFUL" });
    assert.ok(log.matched_lines > 0);
  });
  await t.test("code.check", async () => assert.equal((await call("code", { action: "check", project, files: [file] })).errors, 0));
  await t.test("code.lint", async () => {
    const d = await call("code", { action: "lint", project });
    assert.ok(d.report_artifact); assert.equal(d.exit_code, 0);
  });
  await t.test("code.api-versions-scan", async () => {
    const d = await call("code", { action: "api_versions" }); assert.ok(d.versions.length >= 2);
    const scan = await call("code", { action: "api_scan", project, from: d.versions.at(-2), to: d.versions.at(-1) });
    assert.ok(scan.findings !== undefined);
  });
  await t.test("code.lsp.hover", async () => assert.match((await lsp("hover", { symbol: "message" })).hover, /string/));
  for (const op of ["definition", "declaration"]) await t.test(`code.lsp.${op}`, async () => {
    assert.ok((await lsp(op, { symbol: "middle", line: 1 })).locations.some((l) => l.file.endsWith("Util.ets")));
  });
  await t.test("code.lsp.implementation", async () => {
    assert.ok((await lsp("implementation", { file: "entry/src/main/ets/pages/Shape.ets", symbol: "Shape" })).locations.some((l) => l.file.endsWith("Shape.ets") && l.line >= 5));
  });
  await t.test("code.lsp.references", async () => assert.ok((await lsp("references", { symbol: "message" })).references.length >= 2));
  await t.test("code.lsp.symbols", async () => assert.ok((await lsp("symbols")).symbols.length > 0));
  await t.test("code.lsp.workspace_symbols", async () => assert.ok((await lsp("workspace_symbols", { query: "Square" })).symbols.some((s) => s.name === "Square")));
  await t.test("code.lsp.diagnostics", async () => assert.equal((await lsp("diagnostics")).errors, 0));
  await t.test("code.lsp.completion", async () => {
    const d = await lsp("completion", { file: "entry/src/main/ets/pages/Util.ets", line: 6, column: 14 });
    assert.ok(d.items.some((i) => i.label === "leaf(n: number): number"));
  });
  await t.test("code.lsp.signature", async () => {
    const d = await lsp("signature", { file: "entry/src/main/ets/pages/Util.ets", line: 6, column: 15 });
    assert.match(JSON.stringify(d), /leaf/);
  });
  await t.test("code.lsp.call_hierarchy", async () => {
    assert.deepEqual((await lsp("call_hierarchy", { file: "entry/src/main/ets/pages/Util.ets", symbol: "leaf" })).calls.map((c) => c.name), ["middle"]);
    assert.deepEqual((await lsp("call_hierarchy", { file: "entry/src/main/ets/pages/Util.ets", symbol: "middle", line: 5, direction: "outgoing" })).calls.map((c) => c.name), ["leaf"]);
  });
  await t.test("code.lsp.cpp", async () => {
    await job("project", { action: "build", task: "compileNative", project, wait: 0 });
    const d = await lsp("hover", { file: "entry/src/main/cpp/napi_init.cpp", symbol: "Add", line: 2 }); assert.match(d.hover, /int/);
    const definition = await lsp("definition", { file: "entry/src/main/cpp/napi_init.cpp", symbol: "Add", line: 5 }); assert.ok(definition.locations.some((l) => l.line === 2));
  });
  await t.test("code.lsp_restart", async () => assert.ok((await call("code", { action: "lsp_restart", project, language: "all" })).restarted.includes("arkts")));

});

test("cpp", async (t) => {
  const { call, raw } = await session(t);

  const project = process.env.E2E_PROJECT, file = "entry/src/main/cpp/napi_init.cpp";
  assert.ok(project && path.isAbsolute(project));
  assert.match((await call("project", { action: "info", project })).bundle_name, /^com\.devecomcp\./);
  const source = path.join(project, file), original = fs.readFileSync(source);
  assert.match(original.toString(), /static int Add\(int a, int b\)/);
  const lsp = (op, args = {}) => call("code", { action: "lsp", project, file, op, ...args });
  const line = original.toString().split("\n").length + 1;
  try {
    fs.appendFileSync(source, "\nstruct AuditBase { virtual int value() = 0; };\nstruct AuditDerived final : AuditBase { int value() override { return 1; } };\n");
    await t.test("cpp.declaration", async () => assert.ok((await lsp("declaration", { symbol: "Add", line: 5 })).locations.some((l) => l.line === 2)));
    await t.test("cpp.references", async () => assert.ok((await lsp("references", { symbol: "Add", line: 2 })).references.some((l) => l.line === 5)));
    await t.test("cpp.symbols", async () => assert.ok((await lsp("symbols")).symbols.some((s) => s.name === "NapiAdd")));
    await t.test("cpp.workspace_symbols", async () => assert.ok((await lsp("workspace_symbols", { query: "NapiAdd" })).symbols.some((s) => s.name === "NapiAdd")));
    await t.test("cpp.diagnostics", async () => assert.equal((await lsp("diagnostics")).errors, 0));
    await t.test("cpp.completion", async () => assert.ok((await lsp("completion", { line: 5, column: 23 })).items.some((i) => i.label.trim() === "env")));
    await t.test("cpp.signature", async () => assert.match((await lsp("signature", { line: 5, column: 30 })).signatures[0].label, /Add\(int a, int b\) -> int/));
    await t.test("cpp.incoming", async () => assert.deepEqual((await lsp("call_hierarchy", { symbol: "Add", line: 2 })).calls.map((c) => c.name), ["NapiAdd"]));
    await t.test("cpp.outgoing-explicitly-unavailable", async () => {
      const d = await raw("code", { action: "lsp", project, file, op: "call_hierarchy", symbol: "NapiAdd", line: 3, direction: "outgoing" });
      assert.equal(d.isError, true); assert.equal(d.data.error.code, "CAPABILITY_UNAVAILABLE");
    });
    await t.test("cpp.implementation", async () => assert.ok((await lsp("implementation", { symbol: "value", line })).locations.some((l) => l.line === line + 1 && l.code.includes("AuditDerived"))));
  } finally { fs.writeFileSync(source, original); }
  await t.test("cpp.fixture-restored", async () => assert.deepEqual(fs.readFileSync(source), original));

});

test("SDK catalog resolves across device types", async (t) => {
  const { call, directory, receipt } = await session(t);
  const modules = JSON.parse(fs.readFileSync(new URL("../fixtures/sdk-modules.json", import.meta.url), "utf8"));
  const resolved = Object.fromEntries(modules.map((name) => [name, []]));
  for (const type of ["phone", "2in1", "tablet", "car", "tv", "wearable"]) {
    const project = path.join(directory, type), file = "entry/src/main/ets/pages/Modules.ets";
    await call("project", { action: "create", project, app_name: "Modules", bundle_name: "com.devecomcp.modules" });
    const manifest = path.join(project, "entry/src/main/module.json5"), data = JSON5.parse(fs.readFileSync(manifest, "utf8"));
    data.module.deviceTypes = [type]; fs.writeFileSync(manifest, JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(project, file), modules.map((m, i) => `import * as m${i} from '${m}';`).join("\n") + "\n"
      + modules.map((_, i) => `export const u${i} = m${i};`).join("\n") + "\n");
    const result = await call("code", { action: "lsp", op: "diagnostics", project, file, limit: 200 });
    assert.ok(Array.isArray(result.diagnostics));
    for (let i = 0; i < modules.length; i++) {
      if (!result.diagnostics.some((d) => d.line === i + 1 && (d.code === 2307 || /Cannot find module|system capabilities/.test(d.message)))) resolved[modules[i]].push(type);
    }
  }
  receipt("catalog.json", resolved);
  // This module is available only to privileged SDK applications, not a public device type.
  assert.deepEqual(Object.entries(resolved).filter(([, types]) => !types.length).map(([name]) => name), ["@ohos.wifiext"]);
});


test('knowledge examples compile with the installed SDK', {timeout:180000}, async(t)=>{
  const {call,job,directory}=await session(t),project=path.join(directory,'Knowledge');
  await call('project',{action:'create',project,app_name:'Knowledge',bundle_name:'com.devecomcp.knowledge'});
  const names=['ObjectLiteralTypeError','ObjectLiteralInterfaceError','StandaloneFunctionContext','StandaloneFunctionError','TitleButtonRectTypeError','AvoidAreaTypeError','WindowRectSizeError','WindowTypeError','ResourceConversionError','UnusedVariableWarning','UtilityTypeError','DisplayListenerTypeError','PossiblyNullError','AnyTypeError','ESObjectTypeError','ObjectSpreadError','FunctionReturnTypeError','IDataSourceError'];
  const docs=['object_spread_errors','object_literal_type_errors','function_return_type_errors','object_literal_interface_errors','possibly_null_errors','esobject_type_errors','display_listener_type_errors','any_type_errors','utility_type_errors','unused_variable_warnings','window_type_errors','standalone_function_errors','title_button_rect_type_errors','resource_conversion_errors'];
  const files=[],pages=[];
  function save(name,source){
    const file='entry/src/main/ets/pages/'+name+'.ets';
    if(/^@Entry\b/m.test(source))pages.push('pages/'+name);
    fs.writeFileSync(path.join(project,file),source+'\nexport {};\n');files.push(file);
  }
  for(const name of names)save(name,fs.readFileSync(new URL('../../knowledge/errors/examples/'+name+'.ets',import.meta.url),'utf8'));
  for(const name of docs){
    const text=fs.readFileSync(new URL('../../knowledge/errors/'+name+'.md',import.meta.url),'utf8');
    for(const [i,match] of [...text.matchAll(/```typescript\n([\s\S]*?)```/g)].entries())save('Doc_'+name+'_'+i,match[1]);
  }
  save('QuickRuleContracts',String.raw`
@Entry
@Component
struct QuickRuleContracts {
  @State selection: string = '';
  @State sheetVisible: boolean = false;
  private waterScroller: Scroller = new Scroller();
  @Builder
  sheetContent() {
    Column() { Text('Sheet') }
  }
  build() {
    Column() {
      Button('Pick').onClick(() => {
        TextPickerDialog.show({
          range: ['A', 'B'],
          onAccept: (result: TextPickerResult) => {
            const index = result.index;
            this.selection = typeof index === 'number' ? index.toString() : index.join(',');
          }
        });
      })
      Text(this.selection)
      List() {
        ListItem() { Text('Centered') }.width('50%')
      }.height(100).alignListItem(ListItemAlign.Center)
      WaterFlow({ scroller: this.waterScroller }) {
        FlowItem() { Text('WaterFlow') }
      }.height(100)
      Button('Show sheet').onClick(() => { this.sheetVisible = true; })
        .bindSheet(this.sheetVisible, this.sheetContent, {
          onDisappear: () => { this.sheetVisible = false; }
        })
    }
  }
}
`);
  fs.writeFileSync(path.join(project,'entry/src/main/resources/base/profile/main_pages.json'),JSON.stringify({src:pages}));
  const started=performance.now();
  const first=await call('code',{action:'check',project,files});assert.equal(first.errors,0,JSON.stringify(first));
  const firstMs=performance.now()-started,warmStarted=performance.now();
  const warm=await call('code',{action:'check',project,files});assert.equal(warm.errors,0,JSON.stringify(warm));
  t.diagnostic('Checker timings: first='+Math.round(firstMs)+'ms, warm='+Math.round(performance.now()-warmStarted)+'ms; SDK warnings='+warm.warnings);
  await job('project',{action:'build',project,wait:0});
});
