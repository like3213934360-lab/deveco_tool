import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite, readObject } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const tested = evidenceIdentity(),
  root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const runtime = new Runtime(),
  toolchain = discoverToolchain(),
  // Hvigor 26 rejects Unicode project roots during sync; source paths can still
  // exercise Unicode independently of that native component restriction.
  project_path = path.join(root, "application space"),
  observations: {
    name: string;
    elapsed_ms: number;
    result?: unknown;
    error?: unknown;
  }[] = [];
let failed = false,
  closed = false;
const persist = () =>
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        toolchain,
        scope:
          "Native ArkTS standalone static preflight in an isolated generated project. No compilation, signing, device operation or LSP acceptance.",
        observations,
        closed,
        passed: closed && !failed,
      },
      null,
      2,
    ),
  );
async function observe(name: string, task: () => Promise<unknown>) {
  const started = performance.now();
  try {
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result: await task(),
    });
    observations.at(-1)!.elapsed_ms = performance.now() - started;
    process.stdout.write(`${name}: passed\n`);
  } catch (error) {
    failed = true;
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    process.stdout.write(`${name}: failed\n`);
  } finally {
    persist();
  }
}
const resultSchema = z.object({
  success: z.boolean(),
  checkKind: z.literal("static-precheck"),
  compilationVerified: z.literal(false),
  checked_file_count: z.number(),
  scan: z.object({
    mode: z.enum(["project", "files"]),
    source_bytes: z.number(),
  }),
  checks: z.object({
    sdk: z.literal("executed"),
    system_resources: z.enum(["executed", "unavailable"]),
    router_pages: z.literal("executed"),
    model_version: z.enum(["executed", "unavailable"]),
  }),
  diagnostics: z.array(
    z.object({
      file: z.string(),
      rule: z.string(),
      message: z.string(),
      severity: z.enum(["error", "warning"]),
    }),
  ),
  sdkConfiguration: z.object({
    compatibleSdkVersion: z.number(),
    runtimeOS: z.string(),
  }),
  summary: z.object({ errorCount: z.number(), warnCount: z.number() }),
  truncated: z.boolean(),
  artifact: z.object({ artifact_id: z.string(), bytes: z.number() }),
});
const check = async (input: { files?: string[]; product?: string } = {}) =>
  resultSchema.parse(
    await runtime.call("arkts_check", { project_path, ...input }),
  );
const write = (file: string, value: string) =>
  atomicWrite(path.join(project_path, file), value);
const clean = (result: z.infer<typeof resultSchema>) => {
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.summary.errorCount, 0);
  return result;
};
try {
  const metadata = z
    .object({ data: z.object({ platformVersion: z.string() }) })
    .parse(readObject(path.join(toolchain.sdk, "default/sdk-pkg.json")));
  await runtime.projects.create({
    project_path,
    app_name: "CheckerCanary",
    bundle_name: "com.deveco.checkercanary",
    sdk_version: metadata.data.platformVersion,
  });
  await runtime.projects.sync(runtime.projects.resolve(project_path));
  await observe("clean_project_scope", async () => {
    const result = clean(await check());
    assert.ok(result.checked_file_count >= 2);
    assert.equal(result.scan.mode, "project");
    assert.equal(
      fs.existsSync(path.join(project_path, ".cache/deveco-static")),
      false,
    );
    return result;
  });
  await observe(
    "default_scope_excludes_build_scripts_declarations_and_tests",
    async () => {
      const script = "entry/hvigorfile.ts",
        original = fs.readFileSync(path.join(project_path, script), "utf8"),
        before = clean(await check());
      const ignored = [
        "entry/src/main/ets/Invalid.d.ts",
        "entry/src/main/ets/Invalid.d.ets",
        "entry/src/ohosTest/ets/Invalid.ets",
      ];
      try {
        for (const file of [script, ...ignored])
          write(file, 'export const wrong: number = "must be excluded";\n');
        const result = clean(await check());
        assert.equal(result.checked_file_count, before.checked_file_count);
        return result;
      } finally {
        write(script, original);
        for (const file of ignored) fs.rmSync(path.join(project_path, file));
      }
    },
  );
  await observe("typescript_source_and_module_barrel_errors", async () => {
    const files = ["entry/src/main/ets/Invalid.ts", "entry/Index.ts"];
    try {
      for (const file of files)
        write(file, 'export const wrong: number = "type error";\n');
      const result = await check();
      assert.equal(result.success, false);
      for (const file of files)
        assert.ok(
          result.diagnostics.some(
            (item) =>
              item.file.split(path.sep).join("/") === file &&
              /not assignable/.test(item.message),
          ),
          JSON.stringify(result),
        );
      return result;
    } finally {
      for (const file of files) fs.rmSync(path.join(project_path, file));
    }
  });
  await observe("hms_kit_is_loaded_before_sdk_initialization", async () => {
    assert.ok(
      fs.existsSync(
        path.join(toolchain.sdk, "default/hms/ets/kits/@kit.AccountKit.d.ts"),
      ),
    );
    const file = "entry/src/main/ets/HmsTypes.ets";
    try {
      write(
        file,
        "import { authentication } from '@kit.AccountKit';\nexport function acceptController(value: authentication.AuthenticationController): authentication.AuthenticationController { return value; }\n",
      );
      const result = clean(await check({ files: [file] }));
      assert.equal(result.checked_file_count, 1);
      return result;
    } finally {
      fs.rmSync(path.join(project_path, file));
    }
  });
  await observe("router_missing_malformed_and_repaired", async () => {
    const manifest = "entry/src/main/module.json5",
      original = fs.readFileSync(path.join(project_path, manifest), "utf8"),
      profile = "entry/src/main/resources/base/profile/canary_routes.json";
    const config = z
      .object({ module: z.record(z.string(), z.unknown()) })
      .passthrough()
      .parse(readObject(path.join(project_path, manifest)));
    config.module.pages = "$profile:canary_routes";
    const results = [];
    try {
      write(manifest, JSON.stringify(config));
      for (const content of [
        undefined,
        '{"src":"pages/Index"}',
        '{"src":[3]}',
        '{"src":["pages/Index","pages/Missing"]}',
      ]) {
        if (content !== undefined) write(profile, content);
        const result = await check();
        assert.equal(result.success, false);
        assert.ok(
          result.diagnostics.some(
            (item) =>
              item.rule ===
              (content?.includes("Missing")
                ? "page-file-exists"
                : "page-profile-invalid"),
          ),
          JSON.stringify(result),
        );
        results.push(result);
      }
      write(profile, '{"src":["pages/Index"]}');
      results.push(clean(await check()));
      return results;
    } finally {
      write(manifest, original);
      fs.rmSync(path.join(project_path, profile), { force: true });
    }
  });
  await observe(
    "resource_ast_ignores_comments_and_strings_but_reports_calls",
    async () => {
      const file = "entry/src/main/ets/ResourceCanary.ets";
      try {
        write(
          file,
          `// $r("sys.media.missing_comment")\nexport const description: string = "$r('sys.media.missing_string')";\n`,
        );
        const comments = clean(await check({ files: [file] }));
        assert.equal(comments.checks.system_resources, "executed");
        write(
          file,
          "export const icon: Resource = $r('sys.media.deveco_missing_canary_resource');\n",
        );
        const missing = await check({ files: [file] });
        assert.equal(missing.success, false);
        assert.equal(
          missing.diagnostics.filter(
            (item) => item.rule === "resource-name-check",
          ).length,
          1,
        );
        return { comments, missing };
      } finally {
        fs.rmSync(path.join(project_path, file));
      }
    },
  );
  await observe(
    "sdk_product_changes_keep_real_compatibility_warnings",
    async () => {
      const file = "entry/src/main/ets/Availability.ets",
        profile = "build-profile.json5",
        original = fs.readFileSync(path.join(project_path, profile), "utf8");
      const config = z
        .object({
          app: z
            .object({ products: z.array(z.record(z.string(), z.unknown())) })
            .passthrough(),
        })
        .passthrough()
        .parse(readObject(path.join(project_path, profile)));
      const product = config.app.products[0]!;
      try {
        write(
          file,
          "export function translate(tabs: TabsController): void { tabs.setTabBarTranslate({x: 0, y: 1}); }\n",
        );
        const results = [];
        for (const version of ["5.0.0(12)", "6.1.0(23)", "26.0.0"]) {
          product.compatibleSdkVersion = version;
          product.targetSdkVersion = version;
          write(profile, JSON.stringify(config));
          const result = clean(await check({ files: [file] }));
          assert.equal(
            result.sdkConfiguration.compatibleSdkVersion,
            version === "5.0.0(12)"
              ? 12
              : version === "6.1.0(23)"
                ? 23
                : 260000,
          );
          assert.equal(
            result.diagnostics.some((item) =>
              /setTabBarTranslate.*supported since/.test(item.message),
            ),
            version === "5.0.0(12)",
            JSON.stringify(result),
          );
          results.push(result);
        }
        return results;
      } finally {
        write(profile, original);
        fs.rmSync(path.join(project_path, file));
      }
    },
  );
  await observe(
    "concurrent_checks_release_distinct_owned_scratch_directories",
    async () => {
      const results = (await Promise.all([check(), check()])).map(clean);
      assert.deepEqual(
        runtime.store.db.prepare("SELECT * FROM native_directories").all(),
        [],
      );
      assert.equal(
        fs.existsSync(path.join(project_path, ".cache/deveco-static")),
        false,
      );
      return { results, native_directories: 0, project_cache_created: false };
    },
  );
  await observe("model_version_mismatch_and_repair", async () => {
    const file = "hvigor/hvigor-config.json5",
      original = fs.readFileSync(path.join(project_path, file), "utf8"),
      config = readObject(path.join(project_path, file));
    try {
      config.modelVersion = "0.0.0";
      write(file, JSON.stringify(config));
      const invalid = await check();
      assert.equal(invalid.success, false);
      assert.ok(
        invalid.diagnostics.some(
          (item) => item.rule === "model-version-consistency",
        ),
      );
      write(file, original);
      return { invalid, repaired: clean(await check()) };
    } finally {
      write(file, original);
    }
  });
  await observe("binding_whitelist_retains_unknown_name_errors", async () => {
    const file = "entry/src/main/ets/BindingCanary.ets";
    try {
      write(
        file,
        "@Component struct BindingCanary { @State value: string = 'state'; build() { Text($value) } }\n",
      );
      const binding = clean(await check({ files: [file] }));
      write(
        file,
        "@Component struct BindingCanary { @State value: string = 'state'; build() { Text($missing) } }\n",
      );
      const invalid = await check({ files: [file] });
      assert.equal(invalid.success, false);
      assert.ok(
        invalid.diagnostics.some((item) => item.message.includes("$missing")),
      );
      return { binding, invalid };
    } finally {
      fs.rmSync(path.join(project_path, file));
    }
  });
  await observe(
    "large_diagnostics_are_not_truncated_by_child_pipe_exit",
    async () => {
      const file = "entry/src/main/ets/LargeCanary.ts";
      try {
        write(
          file,
          Array.from(
            { length: 700 },
            (_, index) => `export const invalid${index}: number = 'wrong';`,
          ).join("\n"),
        );
        const result = await check({ files: [file] });
        assert.equal(result.success, false);
        assert.equal(result.summary.errorCount, 700);
        assert.ok(result.diagnostics.length <= 50);
        assert.equal(result.truncated, true);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) < 32768);
        const chunks: Buffer[] = [];
        let offset = 0;
        while (offset < result.artifact.bytes) {
          const chunk = runtime.store.readArtifact(
            result.artifact.artifact_id,
            offset,
          );
          chunks.push(Buffer.from(chunk.data, "base64"));
          offset = chunk.next_offset;
        }
        const full = z
          .object({ diagnostics: z.array(z.unknown()) })
          .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        assert.equal(full.diagnostics.length, 700);
        assert.ok(result.artifact.bytes > 65536);
        return {
          errors: result.summary.errorCount,
          preview_diagnostics: result.diagnostics.length,
          artifact_diagnostics: full.diagnostics.length,
          artifact: result.artifact,
          result_bytes: Buffer.byteLength(JSON.stringify(result)),
        };
      } finally {
        fs.rmSync(path.join(project_path, file));
      }
    },
  );
  await observe("renamed_unicode_module_and_custom_page", async () => {
    const profile = "build-profile.json5",
      original = fs.readFileSync(path.join(project_path, profile), "utf8"),
      config = z
        .object({ modules: z.array(z.record(z.string(), z.unknown())) })
        .passthrough()
        .parse(readObject(path.join(project_path, profile)));
    const oldRoot = path.join(project_path, "entry"),
      nextRoot = path.join(project_path, "features/手机");
    fs.mkdirSync(path.dirname(nextRoot), { recursive: true });
    fs.renameSync(oldRoot, nextRoot);
    try {
      config.modules[0]!.srcPath = "./features/手机";
      write(profile, JSON.stringify(config));
      const result = clean(await check());
      write(
        "features/手机/src/main/resources/base/profile/main_pages.json",
        '{"src":["pages/Index","pages/不存在"]}',
      );
      const missing = await check();
      assert.equal(missing.success, false);
      assert.ok(
        missing.diagnostics.some(
          (item) =>
            item.rule === "page-file-exists" && item.message.includes("不存在"),
        ),
      );
      return { result, missing };
    } finally {
      write(
        "features/手机/src/main/resources/base/profile/main_pages.json",
        '{"src":["pages/Index"]}',
      );
      fs.renameSync(nextRoot, oldRoot);
      write(profile, original);
    }
  });
  await observe("compiled_runtime_and_inputs_remain_identical", async () => {
    const after = evidenceIdentity();
    for (const key of [
      "runtime_sha256",
      "compiled_sha256",
      "package_lock_sha256",
      "resource_manifest_sha256",
      "upstream_lock_sha256",
    ] as const)
      assert.equal(after[key], tested[key], key);
    return { unchanged: true };
  });
} catch (error) {
  failed = true;
  process.stderr.write(JSON.stringify(errorResult(error)) + "\n");
  observations.push({
    name: "setup_or_runtime_failure",
    elapsed_ms: 0,
    error: errorResult(error),
  });
} finally {
  try {
    await runtime.close();
    closed = true;
  } catch (error) {
    failed = true;
    observations.push({
      name: "close_failure",
      elapsed_ms: 0,
      error: errorResult(error),
    });
  }
  persist();
  if (failed) process.exitCode = 1;
}
