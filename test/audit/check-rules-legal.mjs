// Precision side: per rule, VALID code that is shaped like a violation (the patterns that tend to fool
// line-based checks). hvigor must build it; the checker must not report the rule.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { evidence, mcp, record, waitJob } from "./lib.mjs";

const C = "/Applications/DevEco-Studio.app/Contents";
const page = (body, head = "") => `${head}@Entry\n@Component\nstruct Index {\n${body}\n}\n`;
const V2 = (body, head = "") => `${head}@Entry\n@ComponentV2\nstruct Index {\n${body}\n}\n`;
const cases = {
  "resource-name-check": { src: page("  build() {\n    // $r('sys.media.no_such_in_comment')\n    Column() { Text('$r(\\'sys.media.no_such_in_string\\')') }\n  }") },
  "app-resource-name-check (nested module)": { rule: "app-resource-name-check", edit: (r) => nestedHar(r) },
  "app-resource-name-check (comment/string)": { rule: "app-resource-name-check", src: page("  build() {\n    // $r('app.string.nope_in_comment')\n    Column() { Text(\"$r('app.string.nope_in_string')\") }\n  }") },
  "component-decorator-version-mismatch": { src: page("  @State n: number = 0\n  build() { Text(`${this.n}`) }", "// @ComponentV2 mentioned in a comment\n") },
  "observed-v2-state-property-type": { src: V2("  @Local m: M = new M()\n  build() { Text(`${this.m.a}`) }", "@ObservedV2\nclass M {\n  @Trace a: number = 0\n}\n") },
  "regular-property-init": { src: page("  build() { Column() { Child({ v: 1 }) } }", "@ComponentV2\nstruct Child {\n  @Param v: number = 0\n  build() { Text(`${this.v}`) }\n}\n") },
  "struct-name-builtin-collision": { src: page("  build() { Column() { MyButton() } }", "@Component\nstruct MyButton {\n  build() { Button('x') }\n}\n") },
  "entry-build-root-node": { src: page("  build() {\n    // Image() {\n    /* Row() { */\n    Stack() {\n      Text('{ not a block')\n    }\n  }") },
  "builder-body-ui-only": { src: page("  @Builder\n  item(xs: number[]) {\n    ForEach(xs, (x: number) => {\n      Text(`${x}`).onClick(() => {\n        const y: number = x + 1\n        console.info(`${y}`)\n      })\n    }, (x: number) => `${x}`)\n  }\n  private later(): number {\n    let v: number = 1\n    for (let i = 0; i < 2; i++) { v++ }\n    return v\n  }\n  build() { Column() { this.item([1, 2]) } }") },
  "nav-destination-single-builder": { src: page("  stack: NavPathStack = new NavPathStack()\n  @Builder\n  pageMap(name: string) {\n    if (name === 'A') { NavDestination() { Text('A') } } else { NavDestination() { Text('B') } }\n  }\n  build() {\n    Column() {\n      Navigation(this.stack) { Text('one') }\n      .navDestination(this.pageMap)\n      Navigation(this.stack) { Text('two') }\n      .navDestination(this.pageMap)\n    }\n  }") },
  "hide-nav-bar-hides-content": { src: page("  stack: NavPathStack = new NavPathStack()\n  build() {\n    Navigation(this.stack)\n    .hideNavBar(true)\n  }") },
  "nav-destination-root-node": { src: page("  stack: NavPathStack = new NavPathStack()\n  @Builder\n  route(name: string) {\n    NavDestination() {\n      Column() { Text('ok') }\n    }\n  }\n  build() { Navigation(this.stack) { Text('home') }\n  .navDestination(this.route) }") },
  "appstorage-observedv2-mixing": { src: page("  aboutToAppear() { AppStorage.setOrCreate('m', new M()) }\n  build() { Text('x') }", "@Observed\nclass M {\n  a: number = 0\n}\n") },
  "v1-decorator-function-type": { src: page("  build() { Column() { Child({ cb: () => {} }) } }", "@Component\nstruct Child {\n  cb: () => void = () => {}\n  build() { Text('x') }\n}\n") },
  "param-requires-require": { src: V2("  build() { Column() { Child({ v: 1 }) } }").replace("@Entry", "@ComponentV2\nstruct Child {\n  @Require @Param v: number\n  build() { Text(`${this.v}`) }\n}\n@Entry") },
  "permission-reason-required": { rule: "permission-reason-required", edit: (r) => perm(r, { name: "ohos.permission.INTERNET" }) },
};
function perm(root, p) { const mf = path.join(root, "entry/src/main/module.json5"); const j = JSON5.parse(fs.readFileSync(mf, "utf8")); j.module.requestPermissions = [p]; fs.writeFileSync(mf, JSON.stringify(j, null, 2)); }
/** A HAR at a nested srcPath with its own string resource, used by the entry page. */
function nestedHar(root) {
  const dir = path.join(root, "features/sub/mylib");
  fs.mkdirSync(path.join(dir, "src/main/ets"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src/main/resources/base/element"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/main/resources/base/element/string.json"), JSON.stringify({ string: [{ name: "nested_hello", value: "hi" }] }));
  fs.writeFileSync(path.join(dir, "src/main/module.json5"), JSON.stringify({ module: { name: "mylib", type: "har", deviceTypes: ["default", "tablet", "2in1"] } }));
  fs.writeFileSync(path.join(dir, "src/main/ets/Hello.ets"), "@Component\nexport struct Hello {\n  build() { Text($r('app.string.nested_hello')) }\n}\n");
  fs.writeFileSync(path.join(dir, "Index.ets"), "export { Hello } from './src/main/ets/Hello';\n");
  fs.writeFileSync(path.join(dir, "oh-package.json5"), JSON.stringify({ name: "mylib", version: "1.0.0", main: "Index.ets" }));
  fs.writeFileSync(path.join(dir, "build-profile.json5"), JSON.stringify({ apiType: "stageMode", buildOption: {}, targets: [{ name: "default" }] }));
  fs.writeFileSync(path.join(dir, "hvigorfile.ts"), "import { harTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: harTasks, plugins: [] }\n");
  const bp = path.join(root, "build-profile.json5"); const j = JSON5.parse(fs.readFileSync(bp, "utf8")); j.modules.push({ name: "mylib", srcPath: "./features/sub/mylib" }); fs.writeFileSync(bp, JSON.stringify(j, null, 2));
  const ep = path.join(root, "entry/oh-package.json5"); const e = JSON5.parse(fs.readFileSync(ep, "utf8")); e.dependencies = { ...(e.dependencies ?? {}), mylib: "file:../features/sub/mylib" }; fs.writeFileSync(ep, JSON.stringify(e, null, 2));
  fs.writeFileSync(path.join(root, "entry/src/main/ets/pages/Index.ets"), page("  build() { Column() { Hello() } }", "import { Hello } from 'mylib';\n"));
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "audit-legal-"));
const c = await mcp();
const base = path.join(work, "base");
await c.call("project", { action: "create", project: base, app_name: "L", bundle_name: "com.devecomcp.legal" });
const results = [];
for (const [name, spec] of Object.entries(cases)) {
  const rule = spec.rule ?? name;
  const root = path.join(work, name.replace(/[^\w-]/g, "_"));
  fs.cpSync(base, root, { recursive: true });
  if (spec.src) fs.writeFileSync(path.join(root, "entry/src/main/ets/pages/Index.ets"), spec.src);
  spec.edit?.(root);
  if (spec.edit === undefined && false) {}
  if (name.includes("nested")) await waitJob(c, await c.call("project", { action: "sync", project: root, wait: 60000 }));
  let check;
  try { check = JSON.parse(execFileSync(`${C}/tools/node/bin/node`, [path.resolve("resources/vendor/arkts-check.cjs"), "--project", root], { env: { ...process.env, DEVECO_HOME: C }, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString()); }
  catch (e) { try { check = JSON.parse(e.stdout.toString()); } catch { check = { errors: [] }; } }
  const fired = (check.errors ?? []).filter((d) => d.rule === rule || (rule === "regular-property-init" && /property-init/.test(d.rule ?? "")));
  const b = await waitJob(c, await c.call("project", { action: "build", project: root, preflight: false, wait: 60000 }));
  const hvErrs = (b?.error?.details?.diagnostics ?? []).filter((d) => d.severity === "error").map((d) => d.message.slice(0, 160)).slice(0, 4);
  const verdict = b?.status !== "succeeded" ? "case-invalid" : fired.length ? "false-positive" : "ok";
  results.push({ name, rule, verdict, fired: fired.map((d) => `${d.file}:${d.line} ${d.message.slice(0, 160)}`), hvigor: b?.status, hvigor_errors: hvErrs });
  console.log(verdict.padEnd(14), name, "| hvigor", b?.status, hvErrs[0] ?? "");
}
await c.close();
const ev = evidence("check-rules", "rules-legal.json", results);
for (const r of results)
  record(`B.code.check.legal.${r.name.replace(/\s+/g, "_")}`, r.verdict === "ok" ? "VERIFIED" : r.verdict === "false-positive" ? "DEFECT" : "UNVERIFIED",
    r.verdict === "ok" ? "valid look-alike code: hvigor builds, checker silent"
    : r.verdict === "false-positive" ? `valid code (hvigor builds) but checker reports: ${r.fired[0]}`
    : `test case itself does not build (${r.hvigor_errors[0] ?? r.hvigor}) — precision not measurable with it`, [ev]);
fs.rmSync(work, { recursive: true, force: true });
