import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite } from "../src/core/files.js";
import {
  checkerSources,
  checkerRouterPages,
  checkerSdkEnvironment,
} from "../src/services/checker-project.js";
import { parseDiagnostics } from "../src/services/checker.js";
import { parseCheckerReport } from "../src/services/checker-report.js";
import { withTrace } from "../src/core/trace.js";
import { DiagnosticService } from "../src/services/diagnostics.js";
import { ProcessService, type Command } from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import { CpuPool } from "../src/core/cpu-pool.js";

const diagnostic = {
  file: "entry/中文.ets",
  line: 1,
  column: 2,
  severity: "error",
  message: "Type error",
  rule: "fixture",
};
function report(rows = [diagnostic]) {
  const errorCount = rows.filter((row) => row.severity === "error").length;
  return {
    success: errorCount === 0,
    checkKind: "static-precheck",
    compilationVerified: false,
    checked_file_count: 1,
    scan: {
      mode: "project",
      source_roots: ["entry/src/main/ets"],
      source_bytes: 100,
    },
    checks: {
      sdk: "executed",
      system_resources: "unavailable",
      router_pages: "executed",
      model_version: "unavailable",
    },
    sdkConfiguration: {
      runtimeOS: "HarmonyOS",
      compatibleSdkVersion: 26,
      originCompatibleSdkVersion: 26,
    },
    diagnostics: rows,
    summary: { errorCount, warnCount: rows.length - errorCount },
  };
}

function fixture(t: TestContext) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-checker-中文 空格-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modules = ["features/手机", "library"].map((name) => ({
    name,
    root: path.join(root, name),
    target: "default",
  }));
  for (const module of modules) fs.mkdirSync(module.root, { recursive: true });
  const write = (
    file: string,
    content = "export const value: number = 1;\n",
  ) => {
    const absolute = path.join(root, file);
    atomicWrite(absolute, content);
    return absolute;
  };
  return { project: { root, modules }, root, write };
}

test("static project scope includes selected module app sources and barrels, excluding declarations, tools, tests and dependencies", (t) => {
  const { project, write } = fixture(t);
  const expected = [
    write("features/手机/src/main/ets/pages/首页.ets"),
    write("features/手机/src/main/ets/Typed.ts"),
    write("library/Index.ts"),
    write("library/BuildProfile.ets"),
  ];
  for (const file of [
    "features/手机/src/main/ets/Declared.d.ts",
    "features/手机/src/main/ets/Declared.d.ets",
    "features/手机/src/main/ets/oh_modules/dependency.ets",
    "features/手机/src/main/ets/build/Generated.ts",
    "features/手机/src/ohosTest/ets/Test.ets",
    "features/手机/hvigorfile.ts",
    "library/Index.d.ts",
    "other-product/src/main/ets/Excluded.ets",
    "Root.ts",
  ])
    write(file, "invalid source that must not be scanned");
  const result = checkerSources(project);
  assert.deepEqual(new Set(result.files), new Set(expected));
  assert.equal(result.mode, "project");
  assert.equal(
    result.bytes,
    expected.reduce((bytes, file) => bytes + fs.statSync(file).size, 0),
  );
  assert.deepEqual(result.roots, [
    path.join(project.modules[0]!.root, "src/main/ets"),
  ]);
  assert.deepEqual(
    checkerSources({ ...project, modules: [project.modules[1]!] }).files.sort(),
    expected.slice(2).sort(),
  );
});

test("explicit static source scope validates every input and deduplicates canonical files", (t) => {
  const { project, write } = fixture(t),
    file = write("Explicit.ts");
  const result = checkerSources(project, [file, "./Explicit.ts"]);
  assert.deepEqual(result.files, [file]);
  assert.equal(result.mode, "files");
  for (const files of [
    [""],
    [" "],
    ["missing.ets"],
    ["Explicit.js"],
    ["features/手机"],
  ])
    assert.throws(() => checkerSources(project, files), {
      code: "CHECK_SOURCE_INVALID",
    });
  fs.mkdirSync(path.join(project.root, "directory.ets"));
  assert.throws(() => checkerSources(project, ["directory.ets"]), {
    code: "CHECK_SOURCE_INVALID",
  });
  for (const files of [[], undefined])
    assert.throws(() => checkerSources(project, files), {
      code: "NO_FILES_CHECKED",
    });
  write("Oversize.ets", " ".repeat(8 * 1024 * 1024 + 1));
  assert.throws(() => checkerSources(project, ["Oversize.ets"]), {
    code: "CHECK_SOURCE_LIMIT",
  });
});

test("custom router profiles are checked relative to renamed modules, including TypeScript pages", (t) => {
  const { project, write } = fixture(t);
  write(
    "features/手机/src/main/module.json5",
    "{ module: {pages: '$profile:routes'} }",
  );
  write(
    "features/手机/src/main/resources/base/profile/routes.json",
    "{src: ['pages/首页','pages/Typed','pages/Missing']}",
  );
  write("features/手机/src/main/ets/pages/首页.ets");
  write("features/手机/src/main/ets/pages/Typed.ts");
  const result = checkerRouterPages(project);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.rule, "page-file-exists");
  assert.match(result[0]!.file, /routes\.json$/);
  assert.match(result[0]!.message, /Missing/);
  // A directory with a source suffix does not satisfy a router declaration.
  fs.mkdirSync(
    path.join(project.modules[0]!.root, "src/main/ets/pages/Missing.ets"),
  );
  assert.equal(checkerRouterPages(project)[0]?.rule, "page-file-exists");
});

test("declared router profiles fail visibly when missing, malformed or unsafe; absent pages are optional", (t) => {
  const { project, write } = fixture(t),
    prefix = "features/手机/src/main/";
  const manifest = prefix + "module.json5",
    profile = prefix + "resources/base/profile/routes.json";
  write(manifest, "{module:{pages:'$profile:routes'}}");
  assert.equal(checkerRouterPages(project)[0]?.rule, "page-profile-invalid");
  for (const content of [
    "{",
    "{}",
    '{"src":"pages/Index"}',
    '{"src":[3]}',
    '{"src":[""]}',
    '{"src":["../outside"]}',
    '{"src":["/absolute"]}',
    '{"src":["C:/outside"]}',
    '{"src":["pages\\\\Index"]}',
  ]) {
    write(profile, content);
    assert.equal(
      checkerRouterPages(project)[0]?.rule,
      "page-profile-invalid",
      content,
    );
  }
  for (const pages of [
    "plain",
    "$profile:",
    "$profile:..",
    "$profile:../routes",
    "$profile:a:b",
    "$profile:a\n",
  ]) {
    write(manifest, JSON.stringify({ module: { pages } }));
    assert.equal(
      checkerRouterPages(project)[0]?.rule,
      "page-profile-invalid",
      pages,
    );
  }
  write(manifest, "{module:{}}");
  assert.deepEqual(checkerRouterPages(project), []);
  write(manifest, "{module:{pages:'$profile:routes'}}");
  write(profile, "{src:[]}");
  assert.deepEqual(checkerRouterPages(project), []);
});

test("SDK HMS environment uses platform paths and never leaks a missing SDK's external roots", (t) => {
  const { root } = fixture(t),
    sdk = path.join(root, "SDK 空格");
  const open = path.join(sdk, "default/openharmony/ets"),
    hms = path.join(sdk, "default/hms/ets");
  fs.mkdirSync(open, { recursive: true });
  assert.deepEqual(checkerSdkEnvironment(sdk), {
    etsRoots: [open],
    externalApiPaths: "",
  });
  fs.mkdirSync(hms, { recursive: true });
  assert.deepEqual(checkerSdkEnvironment(sdk), {
    etsRoots: [open, hms],
    externalApiPaths: hms,
  });
  assert.deepEqual(checkerSdkEnvironment(path.join(root, "missing")), {
    etsRoots: [],
    externalApiPaths: "",
  });
});

test("SDK diagnostic locations survive ANSI output, Unicode paths, warning severity and rule identifiers", (t) => {
  const { root } = fixture(t),
    file = path.join(root, "首页.ets");
  const result = parseDiagnostics(
    [
      `\u001b[31mArkTS:ERROR File: ${file}:12:3\u001b[0m\n\nType mismatch (arkts-no-any)`,
      `ArkTS:WARN File: ${file}:7:2\nAPI availability warning\nFor details about this error see the SDK`,
    ],
    root,
  );
  assert.deepEqual(result, [
    {
      file: "首页.ets",
      line: 12,
      column: 3,
      severity: "error",
      message: "Type mismatch",
      rule: "arkts-no-any",
    },
    {
      file: "首页.ets",
      line: 7,
      column: 2,
      severity: "warning",
      message: "API availability warning",
      rule: "",
    },
  ]);
});

test("static report previews preserve full counts and validate malformed or contradictory trailing results", () => {
  const value = report(
    Array.from({ length: 100 }, (_, i) => ({
      ...diagnostic,
      line: i + 1,
      severity: i === 99 ? "warning" : "error",
    })),
  );
  const result = parseCheckerReport(JSON.stringify(value));
  assert.equal(result.diagnostics.length, 50);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.summary, { errorCount: 99, warnCount: 1 });
  for (const invalid of [
    "{",
    JSON.stringify({ ...value, success: true }),
    JSON.stringify({ ...value, compilationVerified: true }),
    JSON.stringify({ ...value, summary: { errorCount: 0, warnCount: 100 } }),
    JSON.stringify({
      ...value,
      diagnostics: [
        ...value.diagnostics.slice(0, 99),
        { ...diagnostic, line: -1 },
      ],
    }),
  ])
    assert.throws(() => parseCheckerReport(invalid), {
      code: "CHECKER_REPORT_INVALID",
    });
  assert.throws(() => parseCheckerReport(" ".repeat(16 * 1024 * 1024 + 1)), {
    code: "CHECKER_REPORT_TOO_LARGE",
  });
  assert.equal(parseCheckerReport(JSON.stringify(report([]))).truncated, false);
});

test("static report messages obey Unicode and byte preview budgets without losing severity totals", () => {
  const result = parseCheckerReport(
    JSON.stringify(
      report(
        Array.from({ length: 70 }, () => ({
          ...diagnostic,
          message: "测🙂".repeat(2000),
          file: "长".repeat(2000),
        })),
      ),
    ),
  );
  assert.equal(result.summary.errorCount, 70);
  assert.ok(result.diagnostics.length > 0 && result.diagnostics.length < 50);
  assert.ok(Buffer.byteLength(JSON.stringify(result.diagnostics)) <= 24 * 1024);
  assert.ok(
    result.diagnostics.every(
      (row) => row.truncated && row.message.isWellFormed(),
    ),
  );
});

test("checker service owns each child's cache, validates exit and report contracts, and moves large parsing into its bounded pool", async (t) => {
  const { root, project, write } = fixture(t),
    config = write(
      "config.json",
      JSON.stringify({ clt: path.join(root, "clt") }),
    ),
    oldConfig = process.env.DEVECO_CONFIG;
  write(
    process.platform === "win32"
      ? "clt/tool/node/node.exe"
      : "clt/tool/node/bin/node",
    "fixture",
  );
  process.env.DEVECO_CONFIG = config;
  const processes = new ProcessService(),
    store = new StateStore(path.join(root, "state")),
    cpu = new CpuPool({ workers: 1 }),
    service = new DiagnosticService(processes, store, cpu);
  const selected = {
      ...project,
      product: {
        name: "default",
        compatibleSdkVersion: 26,
        runtimeOS: "HarmonyOS" as const,
      },
      fingerprint: "fixture",
    },
    caches = new Set<string>();
  let content = JSON.stringify(report()),
    exitCode = 0;
  t.mock.method(processes, "run", async (command: Command) => {
    const input = JSON.parse(fs.readFileSync(command.args[2]!, "utf8")) as {
      cache_path: string;
      product: string;
    };
    assert.equal(input.product, "default");
    assert.ok(
      input.cache_path.startsWith(path.dirname(command.args[2]!) + path.sep),
    );
    assert.equal(caches.has(input.cache_path), false);
    caches.add(input.cache_path);
    atomicWrite(path.join(input.cache_path, "owned-cache"), "cache");
    atomicWrite(command.args[3]!, content);
    return {
      exitCode,
      signal: null,
      stdout: "",
      stderr: "",
      truncated: false,
      elapsedMs: 1,
      pid: null,
    };
  });
  try {
    const first = await service.arkts(selected);
    assert.equal((first as { success: boolean }).success, false);
    assert.equal(cpu.metrics.spawned, 0);
    content = JSON.stringify(
      report(
        Array.from({ length: 500 }, () => ({
          ...diagnostic,
          message: "diagnostic ".repeat(100),
        })),
      ),
    );
    const run = store.create("code_diagnose", {}).run;
    const large = (await withTrace({ run_id: run.id }, () =>
      service.arkts(selected),
    )) as {
      summary: { errorCount: number };
      diagnostics: unknown[];
      artifact: { artifact_id: string; bytes: number };
    };
    assert.equal(large.summary.errorCount, 500);
    assert.ok(large.diagnostics.length <= 50);
    assert.equal(large.artifact.bytes, Buffer.byteLength(content));
    assert.equal(cpu.metrics.spawned, 1);
    let offset = 0;
    const chunks: Buffer[] = [];
    while (offset < large.artifact.bytes) {
      const chunk = store.readArtifact(large.artifact.artifact_id, offset);
      chunks.push(Buffer.from(chunk.data, "base64"));
      offset = chunk.next_offset;
    }
    assert.equal(Buffer.concat(chunks).toString("utf8"), content);
    // Both the CPU parser and the native-directory scope must preserve the
    // workflow owner. Retention may run while this task awaits more input.
    store.update(run.id, "needs_input", large);
    store.db.prepare("UPDATE artifacts SET created=0").run();
    store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(run.id);
    store.prune();
    assert.equal(
      store.readArtifact(large.artifact.artifact_id).bytes,
      large.artifact.bytes,
    );
    assert.deepEqual(
      store.db.prepare("SELECT run_id FROM artifacts").all(),
      [{ run_id: run.id }],
      "An unfinished task retains its report; the expired direct-call report is pruned",
    );
    store.claim(run.id);
    store.update(run.id, "succeeded", large);
    store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(run.id);
    store.prune();
    assert.throws(() => store.readArtifact(large.artifact.artifact_id), {
      code: "ARTIFACT_NOT_FOUND",
    });
    exitCode = 1;
    await assert.rejects(service.arkts(selected), {
      code: "CHECKER_EXECUTION_FAILED",
    });
    exitCode = 0;
    content = "{}";
    await assert.rejects(service.arkts(selected), {
      code: "CHECKER_REPORT_INVALID",
    });
    assert.deepEqual(
      store.db.prepare("SELECT * FROM native_directories").all(),
      [],
    );
    assert.ok([...caches].every((cache) => !fs.existsSync(cache)));
  } finally {
    await cpu.close();
    await processes.close();
    store.close();
    if (oldConfig === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = oldConfig;
  }
});
