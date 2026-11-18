import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { openPromise } from "yauzl";
import { test } from "node:test";
import { session, sha } from "../support/acceptance.mjs";
import { waitJob as terminal } from "../support/mcp.mjs";

test("reviewed ArkUI page and media import build into a HAP", async (t) => {
  const { call, raw, job, directory } = await session(t);
  const project = path.join(directory, "App");
  await call("project", { action: "create", project, app_name: "Page import", bundle_name: "com.devecomcp.pageimport" });
  const main = path.join(project, "entry/src/main"), page = path.join(main, "ets/pages/ImportedPage.ets"),
    media = path.join(main, "resources/base/media/imported_image.svg"), profile = path.join(main, "resources/base/profile/main_pages.json");
  const plan = path.join(directory, "import.json"), source = path.join(directory, "Export.ets"), designImage = path.join(directory, "Export.svg");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>';
  const content = `@Entry\n@Component\nstruct ImportedPage {\n  build() {\n    Column() {\n      Text('Imported design')\n      Image($r('app.media.imported_image')).width(32).height(32)\n    }\n  }\n}\n`;
  fs.writeFileSync(source, content);
  fs.writeFileSync(designImage, svg);
  const spec = { module: "entry", page: { name: "ImportedPage", source: "Export.ets" }, media: [{ source: "Export.svg", name: "imported_image.svg" }] };
  const writePlan = (edits) => fs.writeFileSync(plan, JSON.stringify(edits));
  writePlan(spec);
  const args = { action: "import_page", project, plan };
  const originalProfile = fs.readFileSync(profile, "utf8");
  writePlan({ ...spec, page: { ...spec.page, source: "../Outside.ets" } });
  assert.equal((await raw("project", args)).data.error.code, "INVALID_INPUT");
  writePlan(spec);
  const preview = await call("project", args);
  assert.equal(preview.applied, false);
  assert.equal(preview.route, "pages/ImportedPage");
  assert.equal(fs.existsSync(page), false);
  assert.equal(fs.existsSync(media), false);
  assert.equal(fs.readFileSync(profile, "utf8"), originalProfile);
  const evidence = await call("job", { action: "read", artifact_id: preview.review_artifact });
  assert.match(evidence.content, /Text\('Imported design'\)/);
  fs.writeFileSync(source, content.replace("Imported design", "Stale input"));
  const apply = (review_sha256) => call("project", { ...args, review_sha256 });
  const stale = await raw("project", { ...args, review_sha256: preview.review_sha256 });
  assert.equal(stale.data.error.code, "CONFLICT");
  assert.ok(!fs.existsSync(page) && !fs.existsSync(media));
  fs.writeFileSync(source, content);
  assert.equal((await apply(preview.review_sha256)).applied, true);
  assert.equal(fs.readFileSync(page, "utf8"), content);
  assert.equal(fs.readFileSync(media, "utf8"), svg);
  const registered = fs.readFileSync(profile, "utf8");
  assert.equal(registered.replace(', "pages/ImportedPage"', ''), originalProfile);
  assert.deepEqual(JSON.parse(registered).src, ["pages/Index", "pages/ImportedPage"]);
  assert.equal((await raw("project", args)).data.error.code, "CONFLICT");

  const revised = content.replace("Imported design", "Revised design"), revisedSvg = svg.replace("red", "blue");
  fs.writeFileSync(source, revised);
  fs.writeFileSync(designImage, revisedSvg);
  writePlan({ ...spec, page: { name: spec.page.name, replace_sha256: sha(content) }, media: [{ ...spec.media[0], replace_sha256: sha(svg) }] });
  const mediaRevision = await call("project", args);
  fs.appendFileSync(media, "\n");
  assert.equal((await raw("project", { ...args, review_sha256: mediaRevision.review_sha256 })).data.error.code, "CONFLICT");
  assert.equal(fs.readFileSync(page, "utf8"), content);
  fs.writeFileSync(media, svg);
  assert.equal((await apply(mediaRevision.review_sha256)).applied, true);
  assert.equal(fs.readFileSync(page, "utf8"), content);
  assert.equal(fs.readFileSync(media, "utf8"), revisedSvg);
  writePlan({ module: "entry", page: { ...spec.page, replace_sha256: sha(content) } });
  const pageRevision = await call("project", args);
  assert.equal((await apply(pageRevision.review_sha256)).applied, true);
  assert.equal(fs.readFileSync(page, "utf8"), revised);
  assert.equal(fs.readFileSync(media, "utf8"), revisedSvg);
  assert.equal(fs.readFileSync(profile, "utf8"), registered);

  const { result } = await job("project", { action: "build", project, wait: 0 });
  const hap = result.artifacts.find(({ path }) => path.endsWith(".hap"));
  assert.ok(hap, "The real SDK must build a HAP");
  const archive = await openPromise(hap.path, { lazyEntries: true });
  const contained = [];
  for await (const entry of archive.eachEntry()) contained.push(entry.fileName);
  assert.ok(contained.some((file) => file.endsWith("/imported_image.svg")), JSON.stringify(contained));
});


test("design exports compile through reviewed ArkUI import", async (t) => {
  const { call, raw, job, directory } = await session(t);
  const project = path.join(directory, "DesignApp");
  await call("project", { action: "create", project, app_name: "Design converter", bundle_name: "com.devecomcp.designexport" });
  const materials = path.join(directory, "inputs");
  fs.mkdirSync(materials);
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8AgcCGAQaL16////wEkaAa/7EzgdgAAAABJRU5ErkJggg==", "base64");
  fs.writeFileSync(path.join(materials, "badge.png"), image);
  const plan = path.join(materials, "design.json");
  const routeFile = path.join(project, "entry/src/main/resources/base/profile/main_pages.json");
  const pages = () => JSON.parse(fs.readFileSync(routeFile, "utf8")).src;
  const exportArgs = (page, source, more = {}) => {
    fs.writeFileSync(plan, JSON.stringify({ module: "entry", page, source, ...more }));
    return { action: "export_page", project, plan, output: path.join(directory, page), wait: 0 };
  };
  const exportAndImport = async (page, source, more, expected, reused = false, assetBytes = image) => {
    const before = pages();
    const argsForExport = exportArgs(page, source, more);
    const { output, ...inspectArgs } = argsForExport;
    const inspected = (await job("project", inspectArgs)).result;
    assert.equal(inspected.inspected, true);
    assert.equal(inspected.semantic_reviewed, false);
    assert.equal(inspected.source_sha256, sha(fs.readFileSync(path.join(materials, source.file))));
    assert.equal(fs.existsSync(output), false);
    const { result } = await job("project", argsForExport);
    assert.deepEqual(inspected.image_ids, result.image_ids);
    if (source.format === "arkts") assert.deepEqual(inspected.image_ids, { host_badge: "host_badge.png" });
    assert.ok(Object.values(result.image_ids).includes(result.media[0].name));
    assert.equal(inspected.sha256, result.sha256);
    if (source.format !== "arkts") assert.ok(Object.keys(inspected.layout).length > 0);
    assert.equal(inspected.reference_scale, 2);
    assert.deepEqual(fs.readFileSync(result.component_reference_image), image);
    if (source.format === "html") {
      fs.writeFileSync(plan, JSON.stringify({ module: "entry", page, source, ...more, section: "assets" }));
      const selected = (await job("project", inspectArgs)).result;
      assert.deepEqual(selected.report.media, inspected.media);
      assert.equal(selected.section, "assets");
    }
    assert.equal(result.producer, source.format === "arkts" ? "provided" : "native");
    assert.deepEqual(fs.readFileSync(result.reference_image), image);
    const code = fs.readFileSync(result.page, "utf8");
    assert.match(code, expected);
    assert.equal(sha(code), result.sha256);
    assert.equal(result.media.length, 1);
    assert.equal(result.media[0].sha256, sha(assetBytes));
    assert.deepEqual(pages(), before);
    const args = { action: "import_page", project, plan: result.plan };
    const preview = await call("project", args);
    assert.equal(preview.applied, false);
    assert.equal(preview.files.some(({ reuse }) => reuse), reused);
    assert.equal((await call("project", { ...args, review_sha256: preview.review_sha256 })).applied, true);
    assert.deepEqual(pages(), [...before, "pages/" + page]);
    return result.media[0].name;
  };

  const reference = { reference: "badge.png", reference_scale: 2, component_reference: "badge.png" };
  fs.writeFileSync(path.join(materials, "mockup.html"), `<!doctype html><html><body><main style="padding: 12px; background-color: #fff">
    <h1 style="color: #246">收件箱 &amp; 草稿</h1><div style="display: flex; gap: 8px; align-items: center; justify-content: space-between">
      <img src="badge.png" width="24" height="24" alt="未读"/><p>待查看</p>
    </div></main></body></html>`);
  fs.writeFileSync(path.join(materials, "design.tsx"), `const CardText = ({ caption }) => <p style={{fontWeight: 600}}>{caption}</p>;
  function Card({ title }) { return <CardText caption={title}/>; }
  export default function Mockup() {
    return <section style={{ display: "flex", flexDirection: "column", gap: 12, padding: 10, backgroundColor: "#eeeeee" }}>
      <h2>JSX Card</h2><div style={{display: "flex", flexWrap: "wrap", gap: 8, alignContent: "flex-start"}}>
      <img src={"badge.png"} width={20} height={20}/><Card title="Next item"/></div>
    </section>
  }`);
  const rectangle = (x, y, width, height) => ({ x, y, width, height });
  const frame = {
    id: "3:1", type: "FRAME", absoluteBoundingBox: rectangle(100, 50, 360, 320), clipsContent: true,
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: [
      { id: "3:2", type: "TEXT", characters: "Figma Inbox", absoluteBoundingBox: rectangle(116, 70, 160, 30),
        style: { fontSize: 18, fontWeight: 600, textAlignHorizontal: "LEFT" },
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }] },
      { id: "3:3", type: "VECTOR", name: "Badge", absoluteBoundingBox: rectangle(115, 104, 24, 24) },
    ],
  };
  fs.writeFileSync(path.join(materials, "figma.json"), JSON.stringify({ nodes: { "3:1": { document: frame } } }));
  const bitmap = await exportAndImport("HtmlPage", { format: "html", file: "mockup.html" }, reference, /Text\("收件箱 & 草稿"\)/);
  assert.match(fs.readFileSync(path.join(project, "entry/src/main/ets/pages/HtmlPage.ets"), "utf8"),
    /\.alignItems\(VerticalAlign.Center\)\.justifyContent\(FlexAlign.SpaceBetween\)/);
  assert.equal(await exportAndImport("JsxPage", { format: "jsx", file: "design.tsx" }, reference, /Text\("Next item"\)\.fontWeight\(600\)/, true), bitmap);
  assert.match(fs.readFileSync(path.join(project, "entry/src/main/ets/pages/JsxPage.ets"), "utf8"), /wrap: FlexWrap.Wrap.*main: LengthMetrics.vp\(8\).*cross: LengthMetrics.vp\(8\)/);
  assert.equal(await exportAndImport("FigmaPage", { format: "figma", file: "figma.json", node: "3:1" }, { ...reference, assets: { "3:3": "badge.png" } },
    /Text\("Figma Inbox"\).*\.position\(\{ x: 16, y: 20 \}\)/, true), bitmap);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h10v10H0z" fill="#246"/></svg>';
  fs.writeFileSync(path.join(materials, "mark.svg"), svg);
  const paint = (r, g, b) => ({ type: "SOLID", visible: true, color: { r, g, b, a: 1 } });
  fs.writeFileSync(path.join(materials, "pixso.json"), JSON.stringify({ pixTreeNodes: [{
    guid: "5:1", type: "FRAME", width: 360, height: 320, left: 0, top: 0, fillPaints: [paint(245, 240, 234)], childNode: [
      { guid: "5:2", type: "TEXT", width: 180, height: 28, left: 12, top: 10, nodeText: "Pixso Draft", fontSize: 18, fontWeight: 600, fillPaints: [paint(10, 20, 30)] },
      { guid: "5:3", type: "VECTOR", width: 24, height: 24, left: 12, top: 55, svgSha: "exported-vector" },
    ],
  }] }));
  const vector = await exportAndImport("PixsoPage", { format: "pixso", file: "pixso.json" }, { ...reference, assets: { "5:3": "mark.svg" } },
    /Text\("Pixso Draft"\).*\.position\(\{ x: 12, y: 10 \}\)/, false, svg);
  assert.ok(vector.endsWith(".svg"));
  const geometry = (relativeX, relativeY, width, height) => ({ relativeX, relativeY, width, height });
  fs.writeFileSync(path.join(materials, "mastergo.json"), JSON.stringify({ dsl: {
    styles: { "paint_1:1": { value: ["#FFFFFF"] }, "font_9:1": { value: { size: "20", weight: "600" } } },
    nodes: [{ type: "FRAME", id: "1:2", layoutStyle: geometry(0, 0, 360, 320), fill: "paint_1:1", children: [
      { id: "1:3", type: "TEXT", text: [{ text: "MasterGo Card", font: "font_9:1" }], layoutStyle: geometry(14, 18, 160, 24) },
      { id: "1:4", type: "PATH", svgShortKey: "S0:Icon|1:4", layoutStyle: geometry(14, 48, 24, 24) },
    ] }],
  } }));
  assert.equal(await exportAndImport("MastergoPage", { format: "mastergo", file: "mastergo.json", node: "1:2" },
    { ...reference, assets: { "1:4": "mark.svg" } }, /Text\("MasterGo Card"\).*\.position\(\{ x: 14, y: 18 \}\)/, true, svg), vector);
  const lanhuNode = (node_id, parent_id, source_order, node_type, bounds) => ({
    node_id, parent_id, source_order, node_type, bounds, name: node_id, source_visible: true, text: null, asset_ids: [],
  });
  const lanhuInput = { format: "lanhu", file: "node-index.json", context: "design-context.json" };
  const lanhuContext = { schemaVersion: 1, canvas: { width: 360, height: 320 }, coordinateSpace: "source_canvas",
    coordinateMapping: { verified: true }, identity: { snapshotId: "verified-7" }, nodeIndex: { complete: true, count: 3, total: 3 } };
  fs.writeFileSync(path.join(materials, lanhuInput.context), JSON.stringify(lanhuContext));
  fs.writeFileSync(path.join(materials, lanhuInput.file), JSON.stringify({ schemaVersion: 1, snapshotId: "verified-7", complete: true, total: 3, nodes: [
    lanhuNode("board", null, 0, "artboard-group", rectangle(0, 0, 360, 320)),
    { ...lanhuNode("title", "board", 1, "text", rectangle(12, 8, 180, 24)), text: "蓝湖草稿",
      text_spec: { text_runs: [{ offset_unit: "utf16", start: 0, length: 4, text: "蓝湖草稿", font_size: 17,
        font_weight: null, color: "rgba(30,45,60,1)" }] } },
    { ...lanhuNode("icon", "board", 2, "shapeLayer", rectangle(12, 40, 24, 24)), asset_ids: ["icon:image"] },
  ] }));
  assert.equal(await exportAndImport("LanhuPage", lanhuInput, { ...reference, assets: { icon: "mark.svg" } },
    /Text\("蓝湖草稿"\).*\.position\(\{ x: 12, y: 8 \}\)/, true, svg), vector);

  fs.writeFileSync(path.join(materials, "host.ets"), `@Entry
@Component
struct HostPage {
  build() {
    Column() {
      Text('Reviewed host conversion')
      Image($r('app.media.host_badge')).width(24).height(24)
    }
  }
}`);
  assert.equal(await exportAndImport("HostPage", { format: "arkts", file: "host.ets" }, { ...reference, assets: { host_badge: "badge.png" } },
    /Text\('Reviewed host conversion'\)/), "host_badge.png");
  const hostPage = path.join(project, "entry/src/main/ets/pages/HostPage.ets");
  const oldPage = fs.readFileSync(hostPage, "utf8");
  const revision = `import { HdsNavigation, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';

@Entry
@Component
struct HostPage {
  private scroller: Scroller = new Scroller();

  build() {
    HdsNavigation() {
      Scroll(this.scroller) {
        Column() {
          Text('Reviewed host conversion')
          Image($r('app.media.host_badge')).width(24).height(24)
        }
      }
    }.titleBar({
      content: { title: { mainTitle: 'Design review' } },
      style: {
        scrollEffectOpts: { scrollEffectType: ScrollEffectType.IMMERSIVE_GRADIENT_BLUR },
        systemMaterialEffect: {
          materialType: hdsMaterial.MaterialType.IMMERSIVE,
          materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
        }
      }
    }).bindToScrollable([this.scroller])
  }
}`;
  fs.writeFileSync(path.join(materials, "revision.ets"), revision);
  const designPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAAAAAByaaZbAAAAIElEQVR4nGP4QCJgGNUwqmFUw6iGUQ2jGkY1jGoYWRoAzqxweXxe0nkAAAAASUVORK5CYII=", "base64");
  const changedPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAAAAAByaaZbAAAAKElEQVR4nGP4QCJgGNUwqmFQaBBAAqMaRjVQooEYMKphVMOohhGuAQBq8vJqwO6rCgAAAABJRU5ErkJggg==", "base64");
  fs.writeFileSync(path.join(materials, "reference.png"), designPng);
  const revisionArgs = exportArgs("HostPage", { format: "arkts", file: "revision.ets" }, { reference: "reference.png", replace_sha256: sha(oldPage) });
  const { result: stagedRevision } = await job("project", { ...revisionArgs, output: path.join(directory, "host-revision") });
  const importRevision = { action: "import_page", project, plan: stagedRevision.plan };
  const originalRoutes = pages();
  const previewRevision = await call("project", importRevision);
  assert.equal(previewRevision.applied, false);
  assert.equal(fs.readFileSync(hostPage, "utf8"), oldPage);
  assert.equal((await call("project", { ...importRevision, review_sha256: previewRevision.review_sha256 })).applied, true);
  assert.deepEqual(pages(), originalRoutes);
  assert.equal(fs.readFileSync(hostPage, "utf8"), revision);

  const visual = { action: "visual", reference_image: stagedRevision.reference_image, candidate_image: path.join(directory, "candidate.png") };
  fs.writeFileSync(visual.candidate_image, changedPng);
  const firstRound = await call("ui", visual);
  assert.equal(firstRound.same, false);
  assert.equal(firstRound.reference_sha256, sha(designPng));
  assert.equal(firstRound.candidate_sha256, sha(changedPng));
  assert.deepEqual(firstRound.regions, [{ x: 12, y: 14, w: 12, h: 12 }]);
  assert.ok(firstRound.diff_artifact);
  assert.equal((await raw("ui", { ...visual, target: "no-device" })).data.error.code, "INVALID_INPUT");
  fs.writeFileSync(visual.candidate_image, designPng);
  const verifyPlan = path.join(directory, "final-visual.json");
  fs.writeFileSync(verifyPlan, JSON.stringify({ schema: 1, checks: [{ id: "design", type: "visual",
    options: { reference_image: visual.reference_image, candidate_image: visual.candidate_image } }] }));
  const verification = await job("project", { action: "verify", project, plan: verifyPlan, output: path.join(directory, "visual-review"), wait: 0 });
  assert.equal(verification.result.verdict, "passed");
  assert.equal(sha(fs.readFileSync(visual.reference_image)), firstRound.reference_sha256);

  const assertRejected = async (input, expected) => {
    const rejected = await terminal(call, await call("project", input));
    assert.equal(rejected.error.code, expected, JSON.stringify(rejected));
    assert.equal(fs.existsSync(input.output), false);
  };
  fs.writeFileSync(path.join(materials, "dynamic.jsx"), "<section>{fetch('/anything')}</section>");
  await assertRejected(exportArgs("DynamicPage", { format: "jsx", file: "dynamic.jsx" }), "CAPABILITY_UNAVAILABLE");
  fs.writeFileSync(path.join(materials, "recursive.jsx"), "function Loop() {return <Loop/>} export default () => <Loop/>");
  await assertRejected(exportArgs("RecursivePage", { format: "jsx", file: "recursive.jsx" }), "INVALID_INPUT");
  assert.equal((await raw("ui", { action: "visual", reference_image: visual.reference_image, candidate_image: visual.reference_image,
    score_script: path.join(materials, "recursive.jsx") })).data.error.code, "CAPABILITY_UNAVAILABLE");
  await assertRejected(exportArgs("NoFigmaAsset", { format: "figma", file: "figma.json", node: "3:1" }), "EVIDENCE_MISSING");
  fs.writeFileSync(path.join(materials, lanhuInput.context), JSON.stringify({ ...lanhuContext, identity: { snapshotId: "other" } }));
  await assertRejected(exportArgs("MismatchedSnapshot", lanhuInput, { assets: { icon: "mark.svg" } }), "EVIDENCE_MISSING");
  await assertRejected(exportArgs("FigmaLink", { format: "figma", url: "https://www.figma.com/design/abc?node-id=3-1" }), "INVALID_INPUT");
  await assertRejected(exportArgs("MasterGoLink", { format: "mastergo", url: "https://mastergo.com/file/abc?layer_id=1:2" }), "INVALID_INPUT");
  fs.writeFileSync(path.join(materials, "escape.html"), '<img src="../outside.png">');
  await assertRejected(exportArgs("EscapedAsset", { format: "html", file: "escape.html" }), "INVALID_INPUT");
  fs.writeFileSync(path.join(materials, "external.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/resource.png"/></svg>');
  await assertRejected(exportArgs("ExternalAsset", { format: "pixso", file: "pixso.json" }, { assets: { "5:3": "external.svg" } }), "CAPABILITY_UNAVAILABLE");
  const { result } = await job("project", { action: "build", project, wait: 0 });
  const hap = result.artifacts.find(({ path }) => path.endsWith(".hap"));
  assert.ok(hap);
  const archive = await openPromise(hap.path, { lazyEntries: true });
  const resources = [];
  for await (const entry of archive.eachEntry()) if (/\.(?:png|svg)$/.test(entry.fileName)) resources.push(path.basename(entry.fileName));
  assert.equal(resources.filter((file) => file === bitmap).length, 1);
  assert.equal(resources.filter((file) => file === vector).length, 1);
  assert.ok(resources.includes("host_badge.png"));
});

test("native C++ template builds a HAP with its NAPI library", async (t) => {
  const { call, raw, job, directory } = await session(t);
  const project = path.join(directory, "Native"), bundle_name = "com.devecomcp.nativeprobe";
  assert.deepEqual(await call("project", { action: "templates" }), { templates: ["empty-ability", "native-cpp"], default: "empty-ability" });
  const create = { action: "create", project, app_name: "Native probe", bundle_name, template: "native-cpp" };
  assert.equal((await call("project", create)).template, "native-cpp");
  const source = path.join(project, "entry/src/main/cpp/napi_init.cpp"), original = fs.readFileSync(source);
  const conflict = await raw("project", { ...create, merge: true });
  assert.equal(conflict.data.error.code, "CONFLICT");
  assert.deepEqual(fs.readFileSync(source), original);
  const { result } = await job("project", { action: "build", project, debug_line: true, preflight: false, wait: 0 });
  const hap = result.artifacts.find(({ path }) => path.endsWith(".hap"));
  assert.ok(hap, "SDK build must return a HAP");
  const archive = await openPromise(hap.path, { lazyEntries: true });
  const contained = [];
  for await (const entry of archive.eachEntry()) contained.push(entry.fileName);
  for (const abi of ["arm64-v8a", "x86_64"]) assert.ok(contained.includes(`libs/${abi}/libentry.so`), JSON.stringify(contained));
  await t.test("symbolicate an SDK-generated ELF with a matching Build ID", async () => {
    const { checks } = await call("doctor", { remote: false });
    const root = checks.find(({ name }) => name === "toolchain").detail.root;
    const sdkRoot = fs.existsSync(path.join(root, "Contents/sdk")) ? path.join(root, "Contents/sdk") : path.join(root, "sdk");
    const llvm = (name, args) => execFileSync(path.join(sdkRoot, "default/openharmony/native/llvm/bin", process.platform === "win32" ? name + ".exe" : name), args, { encoding: "utf8" });
    const file = path.join(project, "entry/build/default/intermediates/cmake/default/obj/arm64-v8a/libentry.so");
    const build_id = /^\s*Build ID:\s*([a-f0-9]+)$/mi.exec(llvm("llvm-readelf", ["--notes", file]))?.[1];
    const pc = /^([a-f0-9]+)\s+t\s+\S+3AddE\S+$/m.exec(llvm("llvm-nm", ["--defined-only", file]))?.[1];
    assert.ok(build_id && pc, "Expected Build ID and source function in the unstripped ARM64 library");
    const symbolized = await call("diagnose", { action: "symbolize", file, build_id, pc: [pc, "fffffffffffffff0"] });
    assert.equal(symbolized.frames[0].status, "source");
    assert.ok(symbolized.frames[0].symbols.some((s) => s.file.endsWith("napi_init.cpp") && /::Add\(/.test(s.function) && s.line > 0));
    assert.equal(symbolized.frames[1].status, "unresolved");
    const wrong = await raw("diagnose", { action: "symbolize", file, build_id: "00".repeat(build_id.length / 2), pc: [pc] });
    assert.equal(wrong.data.error.code, "CONFLICT");
  });
  const files = ["entry/src/main/ets/pages/Index.ets", "entry/src/main/cpp/napi_init.cpp"];
  const clean = await call("code", { action: "check", project, files });
  assert.equal(clean.errors, 0, JSON.stringify(clean));
  assert.equal(clean.arkts.errors, 0);
  assert.equal(clean.c_cpp.errors, 0);
  const arkts = path.join(project, files[0]);
  const originalArkts = fs.readFileSync(arkts, "utf8");
  try {
    fs.appendFileSync(arkts, "\nlet brokenNativeFixture: any = 1;\n");
    fs.appendFileSync(source, "\nstatic int broken_native_fixture = unknown_native_value;\n");
    const broken = await call("code", { action: "check", project, files });
    assert.ok(broken.arkts.issues.some((item) => item.file.replaceAll("\\", "/").endsWith(files[0])));
    assert.ok(broken.c_cpp.diagnostics.some((item) => item.file.replaceAll("\\", "/").endsWith(files[1]) && item.message.includes("unknown_native_value")));
    assert.ok(broken.arkts.errors > 0 && broken.c_cpp.errors > 0);
    assert.equal(broken.errors, broken.arkts.errors + broken.c_cpp.errors);
  } finally {
    fs.writeFileSync(arkts, originalArkts);
    fs.writeFileSync(source, original);
  }
  await t.test("re-sync ArkTS and clangd without disconnecting the MCP client", async () => {
    const { result: synced } = await job("code", { action: "lsp_restart", project, resync: true, wait: 0 });
    assert.equal(synced.synced, true);
    assert.deepEqual(synced.ready, ["arkts", "cpp"]);
    assert.ok(synced.native.entries > 0);
    const symbols = await call("code", { action: "lsp", op: "symbols", project, file: files[0] });
    assert.ok(JSON.stringify(symbols).includes("Index"));
    const check = await call("code", { action: "check", project, files: [files[1]] });
    assert.equal(check.errors, 0);
  });
});

test("a declared external HAR builds into the project's HAP", async (t) => {
  const { call, raw, job, directory } = await session(t);
  const project = path.join(directory, "App"), external = path.join(directory, "ExternalHar");
  await call("project", { action: "create", project, app_name: "External module", bundle_name: "com.devecomcp.externalprobe" });
  fs.mkdirSync(path.join(external, "src/main"), { recursive: true });
  fs.writeFileSync(path.join(external, "src/main/module.json5"), JSON.stringify({ module: { name: "sharedbits", type: "har", deviceTypes: ["phone"] } }));
  fs.writeFileSync(path.join(external, "build-profile.json5"), "{ apiType: 'stageMode', targets: [{ name: 'default' }] }");
  fs.writeFileSync(path.join(external, "hvigorfile.ts"), "import { harTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: harTasks, plugins: [] };\n");
  fs.writeFileSync(path.join(external, "oh-package.json5"), "{ name: 'sharedbits', version: '1.0.0', main: 'Index.ets', dependencies: {} }");
  fs.writeFileSync(path.join(external, "Index.ets"), "export function label(): string { return 'External HAR'; }\n");
  const entryPackage = path.join(project, "entry/oh-package.json5");
  const pkg = JSON5.parse(fs.readFileSync(entryPackage, "utf8"));
  pkg.dependencies = { ...pkg.dependencies, sharedbits: "file:../../ExternalHar" };
  fs.writeFileSync(entryPackage, JSON.stringify(pkg));
  const entryPage = path.join(project, "entry/src/main/ets/pages/Index.ets");
  fs.writeFileSync(entryPage, "import { label } from 'sharedbits';\n" + fs.readFileSync(entryPage, "utf8").replace("'Hello World'", "label()"));
  const profile = path.join(project, "build-profile.json5");
  const model = JSON5.parse(fs.readFileSync(profile, "utf8"));
  model.modules.push({ name: "sharedbits", srcPath: "../ExternalHar", targets: [{ name: "default", applyToProducts: ["default"] }] });
  fs.writeFileSync(profile, JSON.stringify(model));
  const info = await call("project", { action: "info", project });
  assert.deepEqual(info.modules.map(({ name, path }) => [name, path]), [["entry", "entry"], ["sharedbits", "../ExternalHar"]]);
  const check = await call("code", { action: "check", project, files: ["../ExternalHar/Index.ets"] });
  assert.equal(check.errors, 0, JSON.stringify(check));
  const { result } = await job("project", { action: "build", project, preflight: false, wait: 0 });
  const hap = result.artifacts.find(({ path: file }) => file.endsWith(".hap"));
  assert.ok(hap && hap.path.startsWith(path.join(project, "entry", "build") + path.sep));
  assert.ok(fs.statSync(hap.path).size > 0);
  model.modules.at(-1).srcPath = "../Missing";
  fs.writeFileSync(profile, JSON.stringify(model));
  try { assert.equal((await raw("project", { action: "info", project })).data.error.code, "PROJECT_INVALID"); }
  finally {
    model.modules.at(-1).srcPath = "../ExternalHar";
    fs.writeFileSync(profile, JSON.stringify(model));
  }
});

test("template SDK build", async (t) => {
  const { call, directory } = await session(t);
  const project = path.join(directory, "Template"), bundle = "com.devecomcp.template";
  const waitJob = (status) => terminal(call, status);
  await t.test("doctor", async () => {
    const report = await call("doctor", {});
    assert.equal(report.ok, true, JSON.stringify(report.checks));
  });

  await t.test("create + info", async () => {
    const created = await call("project", { action: "create", project, app_name: "Smoke", bundle_name: bundle });
    assert.ok(created.files > 10);
    const info = await call("project", { action: "info", project });
    assert.equal(info.bundle_name, bundle);
    assert.deepEqual(info.modules.map((m) => m.name), ["entry"]);
  });

  await t.test("code check (ArkTS static)", async () => {
    const check = await call("code", { action: "check", project, files: ["entry/src/main/ets/pages/Index.ets"] });
    assert.equal(check.errors, 0, JSON.stringify(check.issues));
  });

  await t.test("broken code is reported with location", async () => {
    const file = path.join(project, "entry/src/main/ets/pages/Broken.ets");
    fs.writeFileSync(file, "let x: any = 1;\nexport function f(): number { return x; }\n");
    const check = await call("code", { action: "check", project, files: ["entry/src/main/ets/pages/Broken.ets"] });
    assert.ok(check.errors >= 1, JSON.stringify(check));
    assert.ok(check.issues[0].file.includes("Broken.ets"));
    fs.rmSync(file);
  });

  await t.test("build (job) produces a HAP", async () => {
    const status = await waitJob(await call("project", { action: "build", project, wait: 60000 }));
    assert.equal(status.status, "succeeded", JSON.stringify(status.error ?? status).slice(0, 3000));
    assert.ok(status.result.artifacts[0].path.endsWith(".hap"));
    assert.equal(status.result.synced, true);
    assert.equal(status.result.sync_reason, "dependencies not installed");
    const stale = path.join(path.dirname(status.result.artifacts[0].path), "obsolete-signed.hap");
    fs.writeFileSync(stale, "old signed payload from an earlier build");
    const time = fs.statSync(status.result.artifacts[0].path).mtime;
    fs.utimesSync(stale, time, time);
    const incremental = await waitJob(await call("project", { action: "build", project, wait: 60000 }));
    assert.equal(incremental.status, "succeeded", JSON.stringify(incremental.error)); assert.equal(incremental.result.synced, false);
    assert.equal(incremental.result.sync_reason, undefined);
    assert.equal(fs.existsSync(stale), false);
    assert.ok(incremental.result.artifacts.every((a) => a.path !== stale && fs.statSync(a.path).size > 0));
  });

  await t.test("resuming a repaired build refreshes preflight instead of claiming a false positive", async () => {
    const file = path.join(project, "entry/src/main/ets/pages/Index.ets"), original = fs.readFileSync(file, "utf8");
    try {
      fs.writeFileSync(file, `let brokenResumeValue: any = 1;\n${original}`);
      const failed = await waitJob(await call("project", { action: "build", project, wait: 0 }));
      assert.equal(failed.status, "failed");
      assert.equal(failed.error.code, "BUILD_FAILED");
      const detail = await call("job", { action: "status", job_id: failed.job_id, detail: true });
      assert.ok(detail.outputs.preflight.errors > 0);
      const first = detail.outputs.preflight;
      fs.writeFileSync(file, original);
      const resumed = await waitJob(await call("job", { action: "resume", job_id: failed.job_id }));
      assert.equal(resumed.status, "succeeded", JSON.stringify(resumed.error));
      assert.equal(resumed.result.preflight.errors, 0);
      assert.equal(resumed.result.preflight.overruled, undefined);
      assert.notEqual(resumed.result.preflight.source_identity, first.source_identity);
      assert.equal(resumed.result.preflight.source_identity, resumed.result.source_identity);
      assert.ok(resumed.recent_events.some((line) => line.includes("preflight source changed or unverified")));
      assert.ok((await call("job", { action: "read", artifact_id: first.report_artifact, limit: 10 })).content);
    } finally { fs.writeFileSync(file, original); }
  });

  await t.test("lsp resolves HMS kits against the SDK (signature + @since for source conflicts)", async () => {
    const file = "entry/src/main/ets/pages/PushProbe.ets";
    fs.writeFileSync(path.join(project, file), "import { pushService } from '@kit.PushKit';\n\nexport function probe(): void {\n  pushService.getToken();\n}\n");
    try {
      const hover = await call("code", { action: "lsp", op: "hover", project, file, symbol: "getToken", line: 4 });
      assert.match(hover.hover ?? "", /getToken\(\): Promise<string>/, JSON.stringify(hover));
      assert.match(hover.hover, /@since 4\.0\.0\(10\)/);
      const diag = await call("code", { action: "lsp", op: "diagnostics", project, file });
      assert.equal(diag.errors, 0, JSON.stringify(diag.diagnostics));
    } finally {
      fs.rmSync(path.join(project, file));
    }
  });
});

test("SDK kits and dependency changes", async (t) => {
  const { call, job, directory } = await session(t);
  const project = path.join(directory, "Modules"), file = "entry/src/main/ets/pages/Kits.ets";
  await call("project", { action: "create", project, app_name: "Modules", bundle_name: "com.devecomcp.modules" });
  const kits = {
    "@kit.PushKit": ["pushService", "getToken"], "@kit.AccountKit": ["authentication", "HuaweiIDProvider"],
    "@kit.MapKit": ["map", "MapComponentController"], "@kit.ScanKit": ["scanBarcode", "startScanForResult"],
    "@kit.PaymentKit": ["paymentService", "requestPayment"], "@kit.StoreKit": ["productViewManager", "loadProduct"],
    "@kit.ArkUI": ["promptAction", "showToast"], "@kit.AbilityKit": ["abilityAccessCtrl", "createAtManager"],
  };
  fs.writeFileSync(path.join(project, file), Object.entries(kits).map(([k, [ns]]) => `import { ${ns} } from '${k}';`).join("\n") + "\n"
    + Object.values(kits).map(([ns, member], i) => `export const v${i} = ${ns}.${member};`).join("\n") + "\n");
  for (const [kit, [ns, member]] of Object.entries(kits)) await t.test(kit, async () => {
    const hover = await call("code", { action: "lsp", op: "hover", project, file, symbol: `${ns}.${member}` });
    assert.ok(hover.hover); assert.doesNotMatch(hover.hover, /: any\b/);
  });
  assert.equal((await call("code", { action: "lsp", op: "diagnostics", project, file })).errors, 0);
  await job("project", { action: "build", project, preflight: false, wait: 0 });
  // Add actual library modules after the first build, without an explicit sync.
  for (const type of ["har", "shared"]) {
    const name = type === "har" ? "localhar" : "localhsp", lib = path.join(project, name);
    fs.mkdirSync(path.join(lib, "src/main/ets"), { recursive: true });
    fs.writeFileSync(path.join(lib, "src/main/module.json5"), JSON.stringify({ module: { name, type, deviceTypes: ["default"], ...(type === "shared" ? { deliveryWithInstall: true, installationFree: false } : {}) } }));
    fs.writeFileSync(path.join(lib, "Index.ets"), "export function hi(): string { return 'hi'; }\n");
    fs.writeFileSync(path.join(lib, "oh-package.json5"), JSON.stringify({ name, version: "1.0.0", main: "Index.ets" }));
    fs.writeFileSync(path.join(lib, "build-profile.json5"), JSON.stringify({ apiType: "stageMode", buildOption: {}, targets: [{ name: "default" }] }));
    fs.writeFileSync(path.join(lib, "hvigorfile.ts"), `import { ${type === "har" ? "harTasks" : "hspTasks"} } from '@ohos/hvigor-ohos-plugin';\nexport default { system: ${type === "har" ? "harTasks" : "hspTasks"}, plugins: [] };\n`);
    const profile = path.join(project, "build-profile.json5"), data = JSON5.parse(fs.readFileSync(profile, "utf8"));
    data.modules.push({ name, srcPath: `./${name}`, targets: [{ name: "default", applyToProducts: ["default"] }] });
    fs.writeFileSync(profile, JSON.stringify(data, null, 2));
    const manifest = path.join(project, "entry/oh-package.json5"), dependency = JSON5.parse(fs.readFileSync(manifest, "utf8"));
    dependency.dependencies = { ...dependency.dependencies, [name]: `file:../${name}` };
    fs.writeFileSync(manifest, JSON.stringify(dependency, null, 2));
    fs.writeFileSync(path.join(project, `entry/src/main/ets/pages/${name}.ets`), `import { hi } from '${name}';\nexport const value: string = hi();\n`);
    await t.test(`build after adding ${type}`, async () => {
      const built = await job("project", { action: "build", project, preflight: false, wait: 0 });
      assert.ok(built.result.artifacts.some((a) => a.path.endsWith(".hap")));
      assert.ok(fs.existsSync(path.join(project, "entry/oh_modules", name)));
    });
  }
});

test("phone and wearable entry builds remain independently selectable", async (t) => {
  const { call, job, directory } = await session(t), project = path.join(directory, "Entries");
  await call("project", { action: "create", project, app_name: "Entries", bundle_name: "com.devecomcp.entries" });
  fs.cpSync(path.join(project, "entry"), path.join(project, "watch"), { recursive: true });
  const profile = path.join(project, "build-profile.json5"), data = JSON5.parse(fs.readFileSync(profile, "utf8"));
  data.modules.push({ name: "watch", srcPath: "./watch", targets: [{ name: "default", applyToProducts: ["default"] }] });
  fs.writeFileSync(profile, JSON.stringify(data, null, 2));
  const manifest = path.join(project, "watch/src/main/module.json5"), watch = JSON5.parse(fs.readFileSync(manifest, "utf8"));
  watch.module.name = "watch"; watch.module.deviceTypes = ["wearable"];
  fs.writeFileSync(manifest, JSON.stringify(watch, null, 2));
  const info = await call("project", { action: "info", project });
  assert.deepEqual(info.modules.filter((m) => m.type === "entry").map((m) => m.name).sort(), ["entry", "watch"]);
  for (const name of ["entry", "watch"]) {
    const built = await job("project", { action: "build", project, modules: [name], wait: 0 });
    assert.equal(built.result.artifacts.length, 1);
    assert.ok(path.basename(built.result.artifacts[0].path).startsWith(`${name}-`));
  }
});

test("local SDK runtime labels do not establish a native failure", async (t) => {
  const { call, directory } = await session(t), project = path.join(directory, "RuntimeLabel");
  await call("project", { action: "create", project, app_name: "RuntimeLabel", bundle_name: "com.devecomcp.runtimelabel" });
  const tests = path.join(project, "entry/src/test"); fs.mkdirSync(tests, { recursive: true });
  const positive = "import { describe, it, expect } from '@ohos/hypium';\nexport default function testsuite(): void { describe('Pure', () => { it('one', 0, () => { expect(2).assertEqual(2); }); }); }\n";
  const file = path.join(tests, "List.test.ets"); fs.writeFileSync(file, positive);
  await terminal(call, await call("project", { action: "sync", project, wait: 1000 }));
  const input = { action: "test", project, kind: "local", coverage: false, scope: ["Pure"], expected_tests: 1, timeout_ms: 30000, wait: 1000 };
  const passed = await terminal(call, await call("project", input));
  assert.equal(passed.status, "succeeded"); assert.equal(passed.result.counts.passed, 1);
  fs.writeFileSync(file, positive + "\nfunction failAtImport(): number { throw new TypeError('deveco runtime label probe'); }\nconst value: number = failAtImport();\n");
  let failed = await call("project", input);
  try {
    failed = await terminal(call, failed);
    assert.equal(failed.status, "failed"); assert.equal(failed.error.code, "TEST_REPORT_MISSING");
    assert.ok(failed.error.details.diagnostics.some((diagnostic) => diagnostic.code === "00507016"));
    assert.match(failed.error.hint, /not verified root causes/);
    const runtime = fs.readFileSync(path.join(project, "entry/.test/default/intermediates/test/coverage_data/coverage.log"), "utf8");
    assert.match(runtime, /TypeError: deveco runtime label probe/);
  } finally {
    if (["queued", "running"].includes(failed.status)) await call("job", { action: "cancel", job_id: failed.job_id });
    fs.writeFileSync(file, positive);
  }
});
