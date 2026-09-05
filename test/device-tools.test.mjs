import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { verifyUi, closeVisualVerifier } from "../src/arkpilot/visual-verifier.mjs";
import { uiTap, removeUiTemporaryFile } from "../src/device-ui.mjs";
import { hdcLog } from "../src/hdc-log.mjs";
import { uiInspect, uiControl } from "../src/deveco-official.mjs";
import { runRegisteredScript } from "../src/script-registry.mjs";

// Route only the fixture HDC executable through Node. This exercises the real command runner,
// argv, files and exit statuses on Windows too, without depending on executable shell scripts.
async function deviceFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-device-中文 空格-"));
  const hdc = path.join(root, "hdc.mjs");
  const state = path.join(root, "state.json");
  const calls = path.join(root, "calls.jsonl");
  const device = path.basename(root);
  const config = { device, frame: "same", clear: "success", width: 1320, height: 2856 };
  await fs.writeFile(state, JSON.stringify(config));
  await fs.writeFile(hdc, `
    import fs from 'node:fs';
    const args=process.argv.slice(2), state=${JSON.stringify(state)};
    const c=JSON.parse(fs.readFileSync(state,'utf8'));
    fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
    if(args[0]==='list') console.log(c.device);
    else if(args.includes('recv')) {
      const source=args.at(-2), dest=args.at(-1);
      if(source.endsWith('.json')) fs.writeFileSync(dest,JSON.stringify({
        attributes:{type:'root',bounds:'[0,0][1320,2856]'},children:[{
          attributes:{key:'settings',text:'设置',type:'Text',bounds:'[100,100][300,200]',clickable:'true',enabled:'true',visible:'true'}
        }] }));
      else fs.writeFileSync(dest,Buffer.concat([Buffer.from([255,216,255]),Buffer.from((c.frame+':'+(c.captureWidth||c.width)).repeat(100))]));
      console.log('File transfer finish');
    } else if(args.includes('snapshot_display')) {
      if(c.noFrame) {console.log('snapshot_display: capture failed');process.exit(0);}
      const w=args.indexOf('-w'); c.captureWidth=w<0?c.width:Number(args[w+1]);
      fs.writeFileSync(state,JSON.stringify(c));
      console.log('process: display 0, file type: jpeg, width: '+c.width+', height: '+c.height);
      console.log('success: snapshot display 0, write jpeg, width: '+c.captureWidth+', height: '+Math.round(c.height*c.captureWidth/c.width));
    } else if(args.includes('dumpLayout')) console.log('DumpLayout saved to: '+args.at(-1));
    else if(args.includes('uiInput')) console.log('No Error');
    else if(args.some(a=>a.includes('hilog -r')) || args.includes('-r')) {
      if(c.clear==='denied') console.log('Permission denied\\n__DEVECO_HILOG_EXIT__=1');
      else if(c.clear==='denied-zero') console.log('Permission denied\\n__DEVECO_HILOG_EXIT__=0');
      else if(c.clear==='remote-failure') console.log('__DEVECO_HILOG_EXIT__=7');
      else if(c.clear==='missing') console.log('');
      else console.log('clear log buffer successfully\\n__DEVECO_HILOG_EXIT__=0');
    } else if(args.some(a=>a.includes('OBSERVE_OK'))) {console.error('tar: not found');process.exitCode=1;}
  `);
  const previous = process.env.HDC_PATH;
  process.env.HDC_PATH = hdc;
  const spawn = childProcess.spawn;
  childProcess.spawn = (file, args, options) => file === hdc
    ? spawn(process.execPath, [hdc, ...args], options) : spawn(file, args, options);
  syncBuiltinESMExports();
  const temporary = new Set();
  t.after(async () => {
    childProcess.spawn = spawn;
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.HDC_PATH; else process.env.HDC_PATH = previous;
    closeVisualVerifier();
    for (const file of temporary) removeUiTemporaryFile(file);
    await fs.rm(root, { recursive: true, force: true });
  });
  return { device, root, async set(values) {
    await fs.writeFile(state, JSON.stringify({ ...JSON.parse(await fs.readFile(state, "utf8")), ...values }));
  }, async calls() { return (await fs.readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); },
  async verify(input) {
    const report = await verifyUi({ hvd: device, inline: false, ...input });
    for (const file of [report.localPath, report.dumpPath]) if (file) temporary.add(file);
    return report;
  } };
}

test("verify_ui compares the actual baseline width on cold and warm captures", async (t) => {
  const f = await deviceFixture(t);
  // A cold capture learns the native dimensions; the next capture can honor the requested width.
  for (const expectedWidth of [1320, 360]) {
    const baseline = await f.verify({ action: "capture", width: 360 });
    assert.equal(baseline.width, expectedWidth);
    const input = { action: "compare", baseline_id: baseline.verification.snapshotId, expect: "unchanged" };
    const comparison = await f.verify(input);
    assert.equal(comparison.width, expectedWidth);
    assert.equal(comparison.verification.passed, true);
    assert.equal((await f.verify({ ...input, width: expectedWidth })).verification.passed, true);
    await assert.rejects(() => f.verify({ ...input, width: 480 }), { code: "VERIFY_UI_CAPTURE_MISMATCH" });
    await f.set({ frame: "changed" });
    assert.equal((await f.verify(input)).verification.passed, false);
    await f.set({ frame: "same" });
  }
});

test("verify_ui validates semantic assertions before accessing a device", async (t) => {
  for (const selector of [{}, { text: "  " }, { key: "\t", type: " " }, { clickableOnly: true }, { textMode: "exact" }]) {
    for (const action of ["assert", "capture"]) {
      await assert.rejects(() => verifyUi({ action, selector, hvd: "not-connected" }), { code: "FLOW_SELECTOR_INVALID" });
    }
  }
  const f = await deviceFixture(t);
  for (const selector of [{ key: "settings" }, { text: "设置", textMode: "exact" }, { type: "Text" }]) {
    assert.equal((await f.verify({ action: "assert", selector })).verification.passed, true);
  }
  assert.equal((await f.verify({ action: "assert", selector: { text: "absent" } })).verification.passed, false);
  assert.equal((await f.verify({ action: "assert", selector: { text: "absent" }, success_state: "hidden" })).verification.passed, true);
  await f.set({ noFrame: true });
  const noImage = await f.verify({ action: "assert", selector: { text: "设置" } });
  assert.equal(noImage.verification.passed, true, "a missing image does not invalidate a semantic assertion");
  await assert.rejects(() => f.verify({ action: "compare", baseline_id: noImage.verification.snapshotId }),
    { code: "VERIFY_UI_BASELINE_NO_IMAGE" });
});

test("ui_tap reports a post-event observation without claiming the intended outcome", async (t) => {
  const f = await deviceFixture(t);
  const report = await uiTap({ hvd: f.device, action: "click", text: "设置", verify: true });
  t.after(() => removeUiTemporaryFile(report.dumpPath));
  assert.equal(report.commandAccepted, true);
  assert.equal(report.observationCompleted, true);
  assert.equal(report.verified.stillPresent, true);
  assert.equal(report.structureSignature, report.verified.structureSignature);
  assert.equal(report.outcomeVerified, false);
  assert.match(report.verificationHint, /verify_ui/);
});

test("hdc_log clear requires remote completion and rejects permission denials even at exit zero", async (t) => {
  const f = await deviceFixture(t);
  for (const clear of ["denied", "denied-zero", "remote-failure", "missing"]) {
    await f.set({ clear });
    await assert.rejects(() => hdcLog({ action: "clear", device_id: f.device }), { code: "HDC_CLEAR_FAILED" });
  }
  await f.set({ clear: "success" });
  assert.equal((await hdcLog({ action: "clear", device_id: f.device })).cleared, true);
  assert.ok((await f.calls()).some(args => args.includes('hilog -r; rc=$?; printf \'\\n__DEVECO_HILOG_EXIT__=%s\\n\' "$rc"')));
});

test("ui_inspect preserves error words in layout and window data but rejects command failures", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-ui-cli-"));
  const cli = path.join(root, "cli.mjs");
  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = cli;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY; else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  const text = 'BUILD FAILED; error: permission denied; Unhandled exception';
  for (const format of ["json", "default"]) {
    const output = format === "json" ? JSON.stringify({ text }) : `Text { text: ${text} }`;
    await fs.writeFile(cli, `console.log(${JSON.stringify(output)})`);
    for (const action of ["layout", "windows"]) assert.ok(await uiInspect({ action, format }));
  }
  await fs.writeFile(cli, "console.error('Failed to dump layout');process.exitCode=1;");
  await assert.rejects(() => uiInspect({ action: "layout" }), { code: "DEVECO_UI_INSPECT_FAILED" });
  await fs.writeFile(cli, "");
  await assert.rejects(() => uiInspect({ action: "layout" }), { code: "DEVECO_UI_INSPECT_FAILED" });
  await fs.writeFile(cli, "console.log('BUILD FAILED');");
  await assert.rejects(() => uiControl({ action: "click", x: 10, y: 20 }), { code: "DEVECO_UI_CONTROL_FAILED" });
});

const crash = (bundle, type, message, file) => `bundleName: ${bundle}\nError name: ${type}\nError message: ${message}\nStacktrace:\nat run (pages/${file}.ets:12:5)`;
const first = crash("com.example.first", "TypeError", "first failure", "First");
const second = crash("com.example.second", "RangeError", "second failure", "Second");

for (const id of ["parse_jscrash_log", "jscrash_report"]) {
  test(`${id} selects one event for every field and respects the requested bundle`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-crash-中文 空格-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    for (const gap of ["\n", "\n" + "I App: normal operation\n".repeat(55)]) {
      const log = first + gap + second;
      const file = path.join(root, "crash 日志.txt");
      await fs.writeFile(file, log.replaceAll("\n", "\r\n"));
      for (const source of [{ logText: log }, { logFile: file }]) {
        for (const bundleName of [undefined, "com.example.first", "com.example.second"]) {
          const isFirst = bundleName === "com.example.first";
          const result = await runRegisteredScript(id, { args: { ...source, ...(bundleName ? { bundleName } : {}), includeText: true } });
          assert.equal(result.ok, true, JSON.stringify(result));
          const report = result.parsed;
          assert.equal(report.status, "detected");
          assert.equal(report.error_type, isFirst ? "TypeError" : "RangeError");
          assert.equal(report.error_message, isFirst ? "first failure" : "second failure");
          assert.match(report.top_stack, isFirst ? /First\.ets/ : /Second\.ets/);
          assert.doesNotMatch(report.top_stack, isFirst ? /Second\.ets/ : /First\.ets/);
          assert.match(report.text, new RegExp(`error_message: ${report.error_message}`));
          assert.deepEqual(JSON.parse(result.stdout), report, "stdout and parsed diagnostics must agree");
        }
      }
    }
    const unmatched = await runRegisteredScript(id, { args: { logText: first + "\n" + second, bundleName: "com.example.unrelated" } });
    assert.equal(unmatched.parsed.status, "no_crash_signature");
    const processHeaders = (first + "\n" + second).replaceAll('bundleName:', 'Process name:')
      .replaceAll('Stacktrace:', 'Error code: 401\nStacktrace:');
    const processSelected = await runRegisteredScript(id, { args: { logText: processHeaders, bundleName: "com.example.first" } });
    assert.equal(processSelected.parsed.error_message, "first failure");
    assert.match(processSelected.parsed.top_stack, /First\.ets/);
    const repeated = first + "\nRangeError: next failure\nat again (pages/Next.ets:9:1)";
    const latest = await runRegisteredScript(id, { args: { logText: repeated, bundleName: "com.example.first" } });
    assert.equal(latest.parsed.error_type, "RangeError");
    assert.equal(latest.parsed.error_message, "next failure");
    assert.match(latest.parsed.top_stack, /Next\.ets/);
    assert.doesNotMatch(latest.parsed.top_stack, /First\.ets/);
  });

  test(`${id} ignores crash-reporting chatter and parses real exception stacks`, async () => {
    for (const logText of ["I App: crash reporting initialized", "I Monitor: jscrash count: 0", "I App: TypeError handler installed", "normal operation"]) {
      const { parsed } = await runRegisteredScript(id, { args: { logText, includeText: true } });
      assert.equal(parsed.status, "no_crash_signature");
      assert.equal(parsed.error_message, "(not found)");
      assert.equal(parsed.top_stack, "");
      assert.doesNotMatch(parsed.next_action, /minimal fix/);
    }
    for (const prefix of ["", "Uncaught "]) {
      const { parsed } = await runRegisteredScript(id, { args: { logText: `${prefix}TypeError: cannot read property\nat run (pages/Index.ets:7:3)` } });
      assert.equal(parsed.status, "detected");
      assert.equal(parsed.error_type, "TypeError");
      assert.equal(parsed.error_message, "cannot read property");
      assert.match(parsed.top_stack, /Index\.ets/);
    }
    const a = first.split("\n"), b = second.split("\n");
    const interleaved = a.flatMap((line, i) => [
      `09-05 12:00:00.123 101 102 E C03D00/JsCrash: ${line}`,
      `09-05 12:00:00.124 201 202 E C03D00/JsCrash: ${b[i]}`,
    ]).join("\n");
    const { parsed } = await runRegisteredScript(id, { args: { logText: interleaved, processHint: "101" } });
    assert.equal(parsed.error_type, "TypeError");
    assert.equal(parsed.error_message, "first failure");
    assert.match(parsed.top_stack, /First\.ets/);
    assert.doesNotMatch(parsed.top_stack, /Second\.ets/);
  });
}
