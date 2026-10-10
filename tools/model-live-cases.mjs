// Real read-only fixtures. No tool results, fake devices or altered SDK/configuration.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const [project, target, out] = process.argv.slice(2);
assert.ok(project && path.isAbsolute(project) && fs.existsSync(path.join(project, "build-profile.json5")));
assert.ok(target && out && !fs.existsSync(out), "Usage: model-live-cases.mjs <existing absolute project> <explicit target> <new cases.json>");
const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url))).version;
const cases = [
  { id: "environment", goal: `只读检查实际开发环境，设备明确指定为 ${target}，报告 MCP 版本与构建 ID，不联网更新。`, expect: [{ tool: "doctor", result: { server: { version }, ok: true } }] },
  { id: "devices", goal: `列出连接的设备。后续所有设备操作已明确指定 ${target}，不能改用其他设备。`, expect: [{ tool: "device", arguments: { action: "list" } }] },
  { id: "device-info", goal: "查询指定设备的型号、API 和屏幕信息。", expect: [{ tool: "device", arguments: { action: "info", target } }] },
  { id: "device-log", goal: "只读查看该设备最近五分钟包含 Error 的日志，最多五行，不清除日志。", expect: [{ tool: "device", arguments: { action: "log", from: "5m", grep: "Error", lines: 5 } }], forbid: [{ tool: "device", arguments: { clear: true } }] },
  { id: "sqlite", goal: "在该设备的 :memory: SQLite 数据库执行只读 SELECT 1 AS probe，核对返回 1，不建表、不写入文件。", expect: [{ tool: "device", arguments: { action: "sqlite", db: ":memory:", sql: "SELECT 1 AS probe" }, result: { rows: [{ probe: 1 }], total: 1 } }], forbid: [{ tool: "device", arguments: { write: true } }] },
  { id: "shell", goal: "通过设备 MCP 在同一设备执行只读 uname -a，不用宿主终端。", expect: [{ tool: "device", arguments: { action: "shell", command: "uname -a" } }] },
  { id: "project", goal: `只读查看工程 ${project} 的 SDK 和模块。`, expect: [{ tool: "project", arguments: { action: "info", project } }] },
  { id: "code", goal: `对工程 ${project} 的 entry/src/main/ets/pages/Index.ets 做静态检查，不修复、不构建；编译器仍是最终依据。`, expect: [{ tool: "code", arguments: { action: "check", project, files: ["entry/src/main/ets/pages/Index.ets"] } }], forbid: [{ tool: "code", arguments: { fix: true } }] },
  { id: "api-versions", goal: "列出本机 API 兼容性检查可用的 SDK 版本。", expect: [{ tool: "code", arguments: { action: "api_versions" } }] },
  { id: "knowledge", goal: "检索并实际读取 ArkUI @Local 的本地官方文档；根据搜索结果选择真实文档 id。", expect: [{ tool: "knowledge", arguments: { action: "search" } }, { tool: "knowledge", arguments: { action: "read" } }] },
  { id: "catalog", goal: "查看本地知识分类和已安装知识包状态，不联网检查和更新。", expect: [{ tool: "knowledge", arguments: { action: "catalog" } }, { tool: "knowledge", arguments: { action: "status", check: false } }] },
  { id: "skills", goal: "列出内置 Skill，再读取 hmos-runtime-fix-skill，不导出、不安装、不改宿主配置。", expect: [{ tool: "skills", arguments: { action: "list" } }, { tool: "skills", arguments: { action: "read", name: "hmos-runtime-fix-skill" } }] },
  { id: "auth", goal: "只查看华为开发者签名服务登录状态，不登录或注销。", expect: [{ tool: "auth", arguments: { action: "status", provider: "developer" } }] },
  { id: "emulator", goal: "列出现有模拟器、已下载镜像并阅读协议，不启动、创建、下载或接受协议。", expect: [{ tool: "emulator", arguments: { action: "list" } }, { tool: "emulator", arguments: { action: "images" } }, { tool: "emulator", arguments: { action: "license_view" } }], forbid: [{ tool: "emulator", arguments: { action: "license" } }] },
  { id: "jobs", goal: "列出最近五个 MCP 任务，不取消或恢复它们。", expect: [{ tool: "job", arguments: { action: "list", limit: 5 } }] },
  { id: "diagnose", goal: "只分析给定编译诊断 Object literal must correspond to some explicitly declared class or interface，给出修复线索。", expect: [{ tool: "diagnose", arguments: { action: "build", diagnostics: [{ message: "Object literal must correspond to some explicitly declared class or interface" }] } }] },
];
for (const s of cases) for (const c of s.expect) if (c.tool === "device" && c.arguments.action !== "list") c.arguments.target = target;
fs.writeFileSync(out, JSON.stringify(cases, null, 2) + "\n", { mode: 0o600 });
