import { finishAcceptance } from "./lib/acceptance-report.js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite, readObject } from "../src/core/files.js";
import { archiveEntry } from "../src/core/archive.js";
import { errorResult, object } from "../src/core/errors.js";
import type { WorkflowName } from "../src/core/contracts.js";
import { validateCsrPem } from "../src/services/signature.js";
import { inspectApplicationPackages } from "../src/services/package.js";
import { evidenceIdentity } from "./lib/evidence.js";

let completed = false;
const tested = evidenceIdentity();
const root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Acceptance directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const runtime = new Runtime();
const project_path = path.join(root, "application");
const observations: {
  name: string;
  elapsed_ms: number;
  result?: unknown;
  error?: unknown;
}[] = [];
let failed = false;
async function observe(name: string, task: () => Promise<unknown>) {
  const started = performance.now();
  try {
    const result = await task();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${name}: passed\n`);
    return result;
  } catch (error) {
    failed = true;
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    process.stdout.write(`${name}: failed\n`);
    return undefined;
  } finally {
    atomicWrite(
      path.join(root, "evidence.json"),
      JSON.stringify(
        {
          tested,
          platform: process.platform,
          node: process.version,
          toolchain: discoverToolchain(),
          observations,
        },
        null,
        2,
      ),
    );
  }
}
async function workflow(
  workflow: WorkflowName,
  input: Record<string, unknown>,
) {
  const started = z
    .object({ run_id: z.string() })
    .parse(
      await runtime.call("workflow_run", { action: "start", workflow, input }),
    );
  for (;;) {
    const status = z
      .object({ status: z.string(), result: z.unknown(), error: z.unknown() })
      .parse(
        await runtime.call("workflow_run", {
          action: "status",
          run_id: started.run_id,
          wait_ms: 1000,
        }),
      );
    if (status.status === "succeeded") return status;
    assert.ok(
      !["failed", "needs_input", "cancelled", "interrupted"].includes(
        status.status,
      ),
      JSON.stringify(status),
    );
    await delay(20);
  }
}
try {
  const metadata = z
    .object({ data: z.object({ platformVersion: z.string() }) })
    .parse(
      readObject(path.join(discoverToolchain().sdk, "default/sdk-pkg.json")),
    );
  const created = await observe("project_create", () =>
    workflow("project_create", {
      project_path,
      app_name: "NativeCanary",
      bundle_name: "com.deveco.nativecanary",
      sdk_version: metadata.data.platformVersion,
    }),
  );
  if (created) {
    await observe("project_build", () =>
      workflow("project_build", { project_path }),
    );
    await observe("native_hap_identity", async () => {
      const packages = runtime.projects.buildArtifacts(
        runtime.projects.resolve(project_path),
      );
      assert.ok(packages.length > 0);
      return Promise.all(
        packages.map((artifact) =>
          inspectApplicationPackages([artifact.path], {
            bundle_name: "com.deveco.nativecanary",
            module: "entry",
            ability: "EntryAbility",
          }),
        ),
      );
    });
    await observe("static_preflight", async () => {
      const result = await runtime.call("arkts_check", { project_path });
      assert.equal(
        z
          .object({ summary: z.object({ errorCount: z.number() }) })
          .parse(result).summary.errorCount,
        0,
      );
      return result;
    });
    await observe("native_linter", async () => {
      const result = await runtime.call("code_lint", { project_path });
      assert.equal(
        z.object({ report: z.array(z.unknown()) }).parse(result).report.length,
        0,
      );
      return result;
    });
    const file = "entry/src/main/ets/pages/Index.ets";
    const source = fs.readFileSync(path.join(project_path, file), "utf8");
    const lines = source.split("\n"),
      line = lines.findIndex((line) => line.includes("Text(this.message)"));
    await observe("lsp_hover", async () => {
      const result = await runtime.call("lsp", {
        action: "hover",
        project_path,
        file,
        line,
        character: lines[line]!.indexOf("message") + 1,
      });
      assert.match(JSON.stringify(result), /message|string/);
      return result;
    });
    await observe("lsp_references", async () => {
      const result = await runtime.call("lsp", {
        action: "references",
        project_path,
        file,
        line,
        character: lines[line]!.indexOf("message") + 1,
        includeDeclaration: false,
      });
      assert.ok(Array.isArray(result) && result.length >= 2);
      return result;
    });
    await observe("lsp_definition", async () => {
      const result = await runtime.call("lsp", {
        action: "definition",
        project_path,
        file,
        line,
        character: lines[line]!.indexOf("message") + 1,
      });
      assert.ok(Array.isArray(result) && result.length > 0);
      assert.match(JSON.stringify(result), /Index\.ets/);
      return result;
    });
    await observe("lsp_sdk_definition", async () => {
      const result = z.array(z.object({
        uri: z.string().optional(), targetUri: z.string().optional(),
      }).passthrough()).min(1).parse(await runtime.call("lsp", {
        action: "definition", project_path, file, line,
        character: lines[line]!.indexOf("Text(") + 1,
      }));
      const sdk = fs.realpathSync.native(discoverToolchain().sdk);
      for (const location of result) {
        const uri = location.uri ?? location.targetUri;
        assert.ok(uri, "SDK definition must carry a file location");
        const target = fs.realpathSync.native(fileURLToPath(uri));
        const relative = path.relative(sdk, target);
        assert.ok(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
        assert.ok(fs.statSync(target).isFile());
        assert.match(target, /\.d\.(?:ets|ts)$/);
      }
      return result;
    });
    await observe("lsp_implementation", async () => {
      const probe = "entry/src/main/ets/ImplementationProbe.ets";
      fs.writeFileSync(
        path.join(project_path, probe),
        "export interface NativeProbe { value(): string }\nexport class NativeProbeImpl implements NativeProbe {\n  value(): string { return 'native'; }\n}\n",
      );
      try {
        const result = await runtime.call("lsp", {
          action: "implementation",
          project_path,
          file: probe,
          line: 0,
          character: 20,
        });
        assert.ok(Array.isArray(result) && result.length > 0);
        assert.match(JSON.stringify(result), /ImplementationProbe\.ets/);
        return result;
      } finally {
        fs.rmSync(path.join(project_path, probe));
      }
    });
    await observe("lsp_empty_and_position_boundary", async () => {
      const result = await runtime.call("lsp", {
        action: "hover",
        project_path,
        file,
        line: 0,
        character: 0,
      });
      z.union([
        z.null(),
        z.object({ contents: z.array(z.unknown()).length(0) }),
      ]).parse(result);
      await assert.rejects(
        runtime.call("lsp", {
          action: "hover",
          project_path,
          file,
          line: 999999,
        }),
        (error: unknown) => errorResult(error).code === "LSP_INVALID_POSITION",
      );
      return { empty_hover: true, position_checked: true };
    });
    await observe("api_version_catalog", async () => {
      const result = await runtime.call("deveco_doctor", { project_path });
      const api = z
        .object({
          api_compatibility: z.object({ versions: z.array(z.string()).min(2) }),
        })
        .parse(result).api_compatibility;
      assert.ok(api.versions.some((version) => version.includes("(26)")));
      return api;
    });
    await observe("invalid_source_diagnostics", async () => {
      try {
        fs.writeFileSync(
          path.join(project_path, file),
          source.replace(
            "message: string = 'Hello World'",
            "message: string = 123",
          ),
        );
        const result = await runtime.call("arkts_check", {
          project_path,
          files: [file],
        });
        assert.match(
          JSON.stringify(result),
          /not assignable|2322|type.*string/i,
        );
        return result;
      } finally {
        fs.writeFileSync(path.join(project_path, file), source);
      }
    });
    await observe("native_cpp_build", async () => {
      const directory = path.join(project_path, "entry/src/main/cpp");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, "CMakeLists.txt"),
        "cmake_minimum_required(VERSION 3.5.0)\nproject(native_canary)\nadd_library(native_canary SHARED native_canary.cpp)\n",
      );
      fs.writeFileSync(
        path.join(directory, "native_canary.cpp"),
        "int native_value() { return 7; }\n",
      );
      const file = path.join(project_path, "entry/build-profile.json5"),
        profile = readObject(file);
      profile.buildOption = {
        ...object(profile.buildOption),
        externalNativeOptions: {
          path: "./src/main/cpp/CMakeLists.txt",
          arguments: "",
          cppFlags: "",
          abiFilters: ["arm64-v8a"],
        },
      };
      atomicWrite(file, JSON.stringify(profile));
      return workflow("project_build", { project_path });
    });
    await observe("clangd_diagnostics", async () => {
      const file = "entry/src/main/cpp/native_canary.cpp";
      const good = await runtime.call("check_cpp_files", {
        project_path,
        files: [file],
      });
      assert.doesNotMatch(JSON.stringify(good), /undeclared identifier/);
      fs.writeFileSync(
        path.join(project_path, file),
        "int native_value() { return missing_value; }\n",
      );
      try {
        const bad = await runtime.call("check_cpp_files", {
          project_path,
          files: [file],
        });
        assert.match(JSON.stringify(bad), /undeclared identifier/);
        return { good, bad };
      } finally {
        fs.writeFileSync(
          path.join(project_path, file),
          "int native_value() { return 7; }\n",
        );
      }
    });
    const project = runtime.projects.resolve(project_path),
      versionPair = {
        source_version: "HarmonyOS_6.1.1(24)_Release",
        target_version: "HarmonyOS_26.0.0(26)_Release",
      };
    await observe("api_compatibility_findings", async () => {
      const result = await runtime.diagnostics.compatibility(project, {
        ...versionPair,
        files: [file],
      });
      assert.ok(result.affected_locations > 0);
      assert.ok(
        result.findings.every((finding) =>
          finding.location.includes("Index.ets:"),
        ),
      );
      return result;
    });
    await observe("api_compatibility_clean", async () => {
      const file = "entry/src/main/ets/pages/ApiScanClean.ets";
      fs.writeFileSync(
        path.join(project_path, file),
        "export const value: number = 1;\n",
      );
      const result = await runtime.diagnostics.compatibility(project, {
        ...versionPair,
        files: [file],
      });
      assert.equal(result.affected_locations, 0);
      return result;
    });
    const password = crypto.randomUUID(),
      keystore = path.join(root, "validation.p12"),
      csr = path.join(root, "validation.csr");
    await observe("native_keypair", () =>
      runtime.signatures.call({
        action: "keypair",
        output: keystore,
        options: {
          keyAlias: "nativeValidation",
          keystorePwd: password,
          keyPwd: password,
        },
      }),
    );
    await observe("native_csr", async () => {
      const result = await runtime.signatures.call({
        action: "csr",
        output: csr,
        options: {
          keyAlias: "nativeValidation",
          keystoreFile: keystore,
          subject: "CN=Native MCP Validation",
          signAlg: "SHA256withECDSA",
          keystorePwd: password,
          keyPwd: password,
        },
      });
      validateCsrPem(fs.readFileSync(csr, "utf8"));
      return result;
    });
    const lowerProject = path.join(root, "lower-api-application");
    const lowerCreated = await observe("project_create_distinct_runtime_apis", async () => {
      const result = await workflow("project_create", {
        project_path: lowerProject,
        app_name: "LowerApiCanary",
        bundle_name: "com.deveco.lowerapicanary",
        sdk_version: metadata.data.platformVersion,
        compatible_api: 22,
        target_api: 24,
      });
      const project = runtime.projects.resolve(lowerProject);
      assert.equal(project.product.compileSdkVersion, metadata.data.platformVersion);
      assert.equal(project.product.compatibleSdkVersion, "6.0.2(22)");
      assert.equal(project.product.targetSdkVersion, "6.1.1(24)");
      return result;
    });
    if (lowerCreated) {
      await observe("project_build_distinct_runtime_apis", () => workflow("project_build", { project_path: lowerProject }));
      await observe("native_hap_runtime_api_identity", async () => {
        const artifacts = runtime.projects.buildArtifacts(runtime.projects.resolve(lowerProject));
        assert.ok(artifacts.length > 0);
        return Promise.all(artifacts.map(async (artifact) => {
          const manifest = z.object({ app: z.object({ bundleName: z.literal("com.deveco.lowerapicanary"), minAPIVersion: z.number().int(), targetAPIVersion: z.number().int() }) }).parse(
            JSON.parse((await archiveEntry(artifact.path, "module.json", 1048576)).toString("utf8")) as unknown,
          );
          // Hvigor sdk-util apiTransform appends the three-digit API number
          // after the platform prefix; check the actual packaged API values.
          assert.equal(manifest.app.minAPIVersion % 1000, 22);
          assert.equal(manifest.app.targetAPIVersion % 1000, 24);
          return { file: artifact.path, app: manifest.app };
        }));
      });
    }
  }
  await observe("emulator_inventory", () =>
    runtime.call("emulator_manage", { action: "list" }),
  );
  if (process.argv[3]) {
    const target = process.argv[3];
    await observe("device_properties", async () => {
      const result = z
        .object({ properties: z.record(z.string(), z.string()) })
        .parse(await runtime.call("device_info", { target }));
      assert.ok(Object.keys(result.properties).length >= 3);
      return result;
    });
    await observe("device_ui_read", async () => {
      const result = z
        .object({ node_count: z.number().positive() })
        .passthrough()
        .parse(await runtime.call("ui_snapshot", { target, mode: "tree" }));
      return result;
    });
  }
  completed = true;
} finally {
  const closed = await runtime.close();
  finishAcceptance(path.join(root, "evidence.json"), tested, completed && !failed, closed.closed);
  assert.equal(closed.closed, true, JSON.stringify(closed));
  if (failed) process.exitCode = 1;
}
