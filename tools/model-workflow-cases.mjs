// Mutating acceptance uses only an explicitly supplied disposable project and emulator.
// Each invocation gets its own output directory; never overwrite a previous trial's evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const [suite, project, target, directory, out] = process.argv.slice(2);
assert.ok(["project", "ui", "ui-text"].includes(suite) && path.isAbsolute(project) && fs.existsSync(path.join(project, "build-profile.json5")));
assert.ok(target && path.isAbsolute(directory) && !fs.existsSync(directory) && out && !fs.existsSync(out),
  "Usage: model-workflow-cases.mjs project|ui|ui-text <disposable project> <emulator target> <new absolute artifacts directory> <new cases.json>");
fs.mkdirSync(directory, { recursive: true });
const call = (tool, action, args = {}, result) => ({ tool, arguments: { action, ...args }, ...(result ? { result } : {}) });
const ui = (action, args = {}, result) => call("ui", action, { target, ...args }, result);
const input = path.join(directory, "probe.txt"), received = path.join(directory, "received.txt"), remote = `/data/local/tmp/${path.basename(directory)}-probe.txt`;
fs.writeFileSync(input, "MCP real transfer: 中文, quotes ' and \"\n");
const cases = suite === "project" ? [
  { id: "build", goal: `仅操作验收工程 ${project}。清理其构建输出、同步依赖，然后发起一次 wait=0 的构建，按实际 job_id 等待到终态，查看该任务详情并读取完整构建日志。不要用终端代替 MCP。`, expect: [
    call("project", "clean", { project }), call("project", "sync", { project }), call("project", "build", { project, wait: 0 }),
    call("job", "wait", {}, { status: "succeeded" }), call("job", "status", { detail: true }, { status: "succeeded" }), call("job", "read"),
  ] },
  { id: "code", goal: `对 ${project} 运行 Code Linter（不修复）并保存报告到 ${directory}/lint.json；用项目 ArkTS 语言服务读取 entry/src/main/ets/pages/Index.ets 的 message 符号类型和定义，然后重启该项目 ArkTS 服务。`, expect: [
    call("code", "lint", { project, output_path: `${directory}/lint.json` }), call("code", "lsp", { project, op: "hover", symbol: "message" }),
    call("code", "lsp", { project, op: "definition", symbol: "message" }), call("code", "lsp_restart", { project, language: "arkts" }),
  ], forbid: [call("code", "lint", { fix: true })] },
  { id: "transfer", goal: `仅对验收模拟器 ${target}：把 ${input} 发送到 ${remote}，再取回到 ${received}。不得改用别的设备。`, expect: [
    call("device", "send", { target, local: input, remote }), call("device", "recv", { target, remote, local: received }),
  ] },
  { id: "keypair", goal: `仅在本轮临时目录生成本地调试密钥 ${directory}/debug.p12，别名 debug，验收用口令 TestOnly12345；用它生成 CN=McpProbe 的 CSR ${directory}/debug.csr。不调用云端证书创建，不修改项目签名。`, expect: [
    call("sign", "keypair", { out: `${directory}/debug.p12`, key_alias: "debug", keystore_password: "TestOnly12345" }),
    call("sign", "csr", { keystore: `${directory}/debug.p12`, key_alias: "debug", keystore_password: "TestOnly12345", subject: "CN=McpProbe", out: `${directory}/debug.csr` }),
  ], forbid: [call("sign", "auto"), call("sign", "certificate_create"), call("sign", "profile_create")] },
] : suite === "ui-text" ? [
  { id: "text-ui", goal: `仅操作验收工程 ${project} 和模拟器 ${target}。停止并重新启动本测试应用，读取窗口与控件树，定位 Hello World 并断言它可见；点击它后，断言 Welcome 可见。只根据控件树与文字判断，不请求截图、观察画面或视觉评审。每次操作明确指定本设备。`, expect: [
    call("run", "stop", { project, target }), call("run", "launch", { project, target }), ui("windows"), ui("tree"),
    ui("find", { selector: { text: "Hello World" } }), ui("assert", { visible: { text: "Hello World" } }, { passed: true }),
    ui("act", { op: "click", selector: { text: "Hello World" } }), ui("assert", { visible: { text: "Welcome" } }, { passed: true }),
  ], forbid: ["observe", "screenshot", "review", "record_start", "record_stop"].map((action) => ui(action)) },
] : [
  { id: "deploy", goal: `下面只操作验收工程 ${project} 和模拟器 ${target}。部署最近构建包并启动（不构建），等到任务成功；然后停止并重新启动本测试应用。确认 Hello World 可见。`, expect: [
    call("run", "deploy", { project, target }), call("run", "stop", { project, target }), call("run", "launch", { project, target }),
    ui("assert", { visible: { text: "Hello World" } }, { passed: true }),
  ] },
  { id: "observe", goal: `读取该设备当前窗口、完整树、定位 Hello World，并观察截图与控件；再把 PNG 截图保存到 ${directory}/screen.png。`, expect: [
    ui("windows"), ui("tree", { interactive: false, depth: 0 }), ui("find", { selector: { text: "Hello World" } }), ui("observe"),
    ui("screenshot", { format: "png", save_path: `${directory}/screen.png` }),
  ] },
  { id: "flow", goal: `从 Hello World 页面录制本工程路径 probe，点击 Hello World，确认 Welcome 可见后结束并保存录制。列出并读取 probe，再重放它并等待成功，最后删除本轮创建的 probe 路径。`, expect: [
    call("ui_flow", "record", { project, target, id: "probe" }), ui("act", { op: "click", selector: { text: "Hello World" } }),
    call("ui_flow", "stop", { project, target, assert: { visible: { text: "Welcome" } } }), call("ui_flow", "list", { project }),
    call("ui_flow", "show", { project, id: "probe" }), call("ui_flow", "replay", { project, target, id: "probe" }), call("ui_flow", "delete", { project, id: "probe" }),
  ] },
  { id: "test", requires: ["image"], goal: `开始一个保留当前应用状态的 UI 测试会话，计划为“Welcome 可见”。记录名为 Welcome可见 的断言步骤。请求视觉评审截图，要求“Welcome 文本清晰可见”；看过截图后用返回的 review_id 提交真实结论和依据。结束测试，读取不截断的记录，并导出到 ${directory}/test-report。`, expect: [
    ui("test_start", { project, plan: "Welcome 可见", fresh_start: false }), ui("test_step", { description: "Welcome可见", visible: { text: "Welcome" } }),
    ui("review", { requirement: "Welcome 文本清晰可见" }), ui("review", { outcome: "passed" }), ui("test_finish"), ui("test_log", { max_chars: -1 }), ui("test_export", { directory: `${directory}/test-report` }),
  ] },
  { id: "record", goal: `开始该设备录屏，查询录屏状态，通过 MCP 等待两秒后结束，实际保存 MP4 到 ${directory}/capture.mp4，不丢弃录像。`, expect: [
    ui("record_start"), ui("record_status"), ui("record_stop", { save_path: `${directory}/capture.mp4` }),
  ], forbid: [ui("record_stop", { discard: true })] },
  { id: "layout", goal: `检查当前 Welcome 页的布局；在本测试工程创建本轮专用截图基准 probe，然后立即对比它，不替换其他基准。`, expect: [
    ui("layout"), ui("visual", { project, name: "probe", update: true }), ui("visual", { project, name: "probe", update: false }),
  ] },
];
fs.writeFileSync(out, JSON.stringify(cases, null, 2) + "\n", { mode: 0o600 });
