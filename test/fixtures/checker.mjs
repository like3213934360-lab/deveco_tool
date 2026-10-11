// Independent checker/SDK cases; each rule has a violating and valid look-alike input.
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";

const page = (body, head = "") => `${head}@Entry\n@Component\nstruct Index {\n${body}\n}\n`;
const V2 = (body, head = "") => `${head}@Entry\n@ComponentV2\nstruct Index {\n${body}\n}\n`;
/** name -> { files: {relPath: content}, edit?: (root)=>void, runtime?: true } */
export const violations = {
  "resource-name-check": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() {\n    Column() { Text($r('sys.color.no_such_sys_color_xyz')) }\n  }") } },
  "app-resource-name-check": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() {\n    Column() { Text($r('app.string.no_such_string_xyz')) }\n  }") } },
  "page-file-exists": { edit: (r) => addPage(r, "pages/Missing") },
  "page-entry-count": { edit: (r) => { addPage(r, "pages/NoEntry"); fs.writeFileSync(path.join(r, "entry/src/main/ets/pages/NoEntry.ets"), "@Component\nexport struct NoEntry {\n  build() { Text('x') }\n}\n"); } },
  "route-map-invalid-json": { edit: (r) => routeMap(r, "{ this is not json") },
  "route-map-unknown-key": { edit: (r) => routeMap(r, JSON.stringify({ routerMap: [{ name: "a", pageSourceFile: "src/main/ets/pages/Index.ets", buildFunction: "b", bogus: 1 }] })) },
  "route-map-missing-key": { edit: (r) => routeMap(r, JSON.stringify({ routerMap: [{ name: "a", buildFunction: "b" }] })) },
  "route-map-build-function-missing": { edit: (r) => routeMap(r, JSON.stringify({ routerMap: [{ name: "a", pageSourceFile: "src/main/ets/pages/Index.ets", buildFunction: "noSuchBuilder" }] })) },
  "resource-dir-name": { edit: (r) => fs.mkdirSync(path.join(r, "entry/src/main/resources/zz-bogus-qualifier/element"), { recursive: true }) },
  "component-decorator-version-mismatch": { files: { "entry/src/main/ets/pages/Index.ets": V2("  @State n: number = 0\n  build() { Text(`${this.n}`) }") } },
  "observed-v2-state-property-type": { files: { "entry/src/main/ets/pages/Index.ets": page("  @State m: M = new M()\n  build() { Text(`${this.m.a}`) }", "@ObservedV2\nclass M {\n  @Trace a: number = 0\n}\n") } },
  "regular-property-init": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() { Column() { Child({ v: 1 }) } }", "@ComponentV2\nstruct Child {\n  v: number = 0\n  build() { Text(`${this.v}`) }\n}\n") } },
  "struct-name-builtin-collision": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() { Column() { Button() } }", "@Component\nstruct Button {\n  build() { Text('x') }\n}\n") } },
  "entry-build-root-node": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() {\n    Image($r('app.media.startIcon'))\n  }") } },
  "builder-body-ui-only": { files: { "entry/src/main/ets/pages/Index.ets": page("  @Builder\n  item() {\n    let x: number = 1\n    Text(`${x}`)\n  }\n  build() { Column() { this.item() } }") } },
  "nav-destination-root-node": { runtime: true, files: { "entry/src/main/ets/pages/Index.ets": page("  stack: NavPathStack = new NavPathStack()\n  @Builder\n  route(name: string) {\n    if (name === 'a') {\n      Column() { Text('a') }\n    }\n  }\n  build() { Navigation(this.stack) { Text('home') }.navDestination(this.route) }") } },
  "nav-destination-single-builder": { runtime: true, files: { "entry/src/main/ets/pages/Index.ets": page("  stack: NavPathStack = new NavPathStack()\n  @Builder\n  r1(name: string) { NavDestination() { Text('1') } }\n  @Builder\n  r2(name: string) { NavDestination() { Text('2') } }\n  build() { Column() { Navigation(this.stack) { Text('a') }.navDestination(this.r1)\n Navigation(this.stack) { Text('b') }.navDestination(this.r2) } }") } },
  "hide-nav-bar-hides-content": { runtime: true, files: { "entry/src/main/ets/pages/Index.ets": page("  stack: NavPathStack = new NavPathStack()\n  build() { Navigation(this.stack) { Text('home') }.hideNavBar(true) }") } },
  "appstorage-observedv2-mixing": { runtime: true, files: { "entry/src/main/ets/pages/Index.ets": page("  aboutToAppear() { AppStorage.setOrCreate('m', new M()) }\n  build() { Text('x') }", "@ObservedV2\nclass M {\n  @Trace a: number = 0\n}\n") } },
  "v1-decorator-function-type": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() { Column() { Child({ cb: () => {} }) } }", "@Component\nstruct Child {\n  @Prop cb: () => void = () => {}\n  build() { Text('x') }\n}\n") } },
  "param-requires-require": { files: { "entry/src/main/ets/pages/Index.ets": V2("  build() { Column() { Child({ v: 1 }) } }").replace("@Entry", "@ComponentV2\nstruct Child {\n  @Param v: number\n  build() { Text(`${this.v}`) }\n}\n@Entry") } },
  "object-link-observed-type": { files: { "entry/src/main/ets/pages/Index.ets": page("  @State p: P = new P()\n  build() { Column() { Child({ p: this.p }) } }", "class P {\n  a: number = 0\n}\n@Component\nstruct Child {\n  @ObjectLink p: P\n  build() { Text(`${this.p.a}`) }\n}\n") } },
  "model-version-consistency": { edit: (r) => { const f = path.join(r, "hvigor/hvigor-config.json5"); const j = JSON5.parse(fs.readFileSync(f, "utf8")); j.modelVersion = "5.0.0"; fs.writeFileSync(f, JSON.stringify(j, null, 2)); } },
  "permission-reason-required": { edit: (r) => perm(r, { name: "ohos.permission.CAMERA", usedScene: { abilities: ["EntryAbility"], when: "inuse" } }) },
  "permission-reason-resource": { edit: (r) => perm(r, { name: "ohos.permission.CAMERA", reason: "$string:no_such_reason_key", usedScene: { abilities: ["EntryAbility"], when: "inuse" } }) },
  "permission-name-exists": { edit: (r) => perm(r, { name: "ohos.permission.NO_SUCH_PERMISSION_XYZ" }) },
};

function addPage(root, p) {
  const f = path.join(root, "entry/src/main/resources/base/profile/main_pages.json");
  const j = JSON.parse(fs.readFileSync(f, "utf8")); j.src.push(p); fs.writeFileSync(f, JSON.stringify(j, null, 2));
}
function routeMap(root, text) {
  fs.writeFileSync(path.join(root, "entry/src/main/resources/base/profile/route_map.json"), text);
  const mf = path.join(root, "entry/src/main/module.json5");
  const j = JSON5.parse(fs.readFileSync(mf, "utf8")); j.module.routerMap = "$profile:route_map"; fs.writeFileSync(mf, JSON.stringify(j, null, 2));
}
function perm(root, p) {
  const mf = path.join(root, "entry/src/main/module.json5");
  const j = JSON5.parse(fs.readFileSync(mf, "utf8")); j.module.requestPermissions = [p]; fs.writeFileSync(mf, JSON.stringify(j, null, 2));
}

export const legal = {
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

export const runtime = {
  "object-link-observed-type": `class P {\n  a: number = 0\n}\n\n@Component\nstruct Child {\n  @ObjectLink p: P\n\n  build() {\n    Text(\`\${this.p.a}\`)\n  }\n}\n\n@Entry\n@Component\nstruct Index {\n  @State p: P = new P()\n\n  build() {\n    Column() {\n      Child({ p: this.p })\n    }\n  }\n}\n`,
  "nav-destination-single-builder": `@Entry\n@Component\nstruct Index {\n  stack: NavPathStack = new NavPathStack()\n\n  @Builder\n  pageA(name: string) {\n    NavDestination() { Text('A') }\n  }\n\n  @Builder\n  pageB(name: string) {\n    NavDestination() { Text('B') }\n  }\n\n  build() {\n    Navigation(this.stack) {\n      Text('Hello World').id('go').onClick(() => { this.stack.pushPath({ name: 'A' }) })\n    }\n    .navDestination(this.pageA)\n    .navDestination(this.pageB)\n  }\n}\n`,
  "hide-nav-bar-hides-content": `@Entry\n@Component\nstruct Index {\n  stack: NavPathStack = new NavPathStack()\n\n  build() {\n    Navigation(this.stack) {\n      Text('Hello World')\n    }\n    .hideNavBar(true)\n  }\n}\n`,
  "nav-destination-root-node": `@Entry\n@Component\nstruct Index {\n  stack: NavPathStack = new NavPathStack()\n\n  @Builder\n  route(name: string) {\n    Column() { Text('ROUTED') }\n  }\n\n  build() {\n    Navigation(this.stack) {\n      Text('Hello World').id('go').onClick(() => { this.stack.pushPath({ name: 'A' }) })\n    }\n    .navDestination(this.route)\n  }\n}\n`,
  "appstorage-observedv2-mixing": `@ObservedV2\nclass M {\n  @Trace a: number = 0\n}\n\n@Entry\n@Component\nstruct Index {\n  aboutToAppear() {\n    AppStorage.setOrCreate('m', new M())\n  }\n\n  build() {\n    Text('Hello World')\n  }\n}\n`,
};
