import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { digest, fileDigest, readObject } from "../core/files.js";
import { errorResult, invariant } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import type { Toolchain } from "../core/toolchain.js";
import type { Project } from "./project.js";
import { projectTargets } from "./project.js";
import {
  inputTreeIdentity,
  runtimeEvidenceIdentity,
} from "./evidence-identity.js";
import { resolveEvidenceResult } from "./evidence-result.js";

export type SyncPolicy = "auto" | "force" | "skip" | boolean;
const receiptSchema = z.strictObject({
  format: z.literal(1),
  project_path: z.string(),
  product: z.string(),
  module_targets: z.record(z.string(), z.string()),
  inputs_sha256: z.string(),
  model_sha256: z.string(),
  toolchain_sha256: z.string(),
  runtime_sha256: z.string(),
  environment_sha256: z.string(),
});

/** Only the stock declarative task files permit ignoring ArkTS implementation bytes. */
function stockTasks(file: string, task: string) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  if (Buffer.byteLength(text) > 65536) return false;
  const tokens =
    text.match(
      /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][\w$]*|[^\s]/g,
    ) ?? [];
  const code = tokens
    .filter((token) => !token.startsWith("/*") && !token.startsWith("//"))
    .join("");
  return new RegExp(
    `^import\\{${task}\\}from(['"])@ohos/hvigor-ohos-plugin\\1;?exportdefault\\{system:${task},plugins:\\[\\],?\\};?$`,
  ).test(code);
}
function assertInstalled(project: Project) {
  for (const root of [
    project.root,
    ...project.modules.map((module) => module.root),
  ]) {
    for (const manifest of ["oh-package.json5", "package.json"]) {
      const file = path.join(root, manifest);
      if (!fs.existsSync(file)) continue;
      const metadata = readObject(file),
        folder = manifest === "package.json" ? "node_modules" : "oh_modules";
      const declarations = {
        ...z.record(z.string(), z.unknown()).parse(metadata.dependencies ?? {}),
        ...z
          .record(z.string(), z.unknown())
          .parse(metadata.devDependencies ?? {}),
      };
      for (const name of Object.keys(declarations)) {
        invariant(
          /^(?:@[\w.-]+\/)?[\w.-]+$/.test(name),
          "SYNC_DEPENDENCY_UNVERIFIED",
          "Dependency name cannot be resolved safely",
        );
        const installed = [...new Set([root, project.root])]
          .map((base) => path.join(base, folder, name, manifest))
          .find((file) => fs.existsSync(file));
        invariant(
          installed,
          "SYNC_DEPENDENCY_MISSING",
          `Installed dependency is missing: ${name}`,
        );
        invariant(
          typeof readObject(installed).version === "string",
          "SYNC_DEPENDENCY_UNVERIFIED",
          `Installed dependency manifest is invalid: ${name}`,
        );
      }
      if (Object.keys(declarations).length) {
        const lock =
          manifest === "package.json"
            ? "package-lock.json"
            : "oh-package-lock.json5";
        invariant(
          [root, project.root].some((base) =>
            fs.existsSync(path.join(base, lock)),
          ),
          "SYNC_LOCK_MISSING",
          `A retained install lock is required: ${lock}`,
        );
      }
    }
  }
}

/** No wall-clock freshness heuristic. Missing/broken state simply disables reuse. */
export function captureSyncReceipt(
  project: Project,
  toolchain: () => Toolchain,
  validateModel: () => unknown,
) {
  try {
    invariant(
      stockTasks(path.join(project.root, "hvigorfile.ts"), "appTasks"),
      "SYNC_CUSTOM_TASKS",
      "Custom root build logic requires synchronization",
    );
    const ignoredSources: string[] = [];
    for (const module of project.modules) {
      const metadata = z
        .object({ module: z.object({ type: z.string() }) })
        .parse(readObject(path.join(module.root, "src/main/module.json5")));
      const task = (
        {
          entry: "hapTasks",
          feature: "hapTasks",
          har: "harTasks",
          shared: "hspTasks",
        } as Record<string, string>
      )[metadata.module.type];
      invariant(
        task && stockTasks(path.join(module.root, "hvigorfile.ts"), task),
        "SYNC_CUSTOM_TASKS",
        `Custom module build logic requires synchronization: ${module.name}`,
      );
      ignoredSources.push(
        path.relative(project.root, path.join(module.root, "src/main/ets")) +
          path.sep,
      );
    }
    const hvigor = readObject(
      path.join(project.root, "hvigor/hvigor-config.json5"),
    );
    invariant(
      Object.keys(
        z.record(z.string(), z.unknown()).parse(hvigor.dependencies ?? {}),
      ).length === 0,
      "SYNC_CUSTOM_TASKS",
      "Custom Hvigor dependencies require synchronization",
    );
    assertInstalled(project);
    validateModel();
    const inputs = inputTreeIdentity(
      project.root,
      new Set([".git"]),
      (relative) => {
        const parts = relative.split(path.sep);
        // Installed packages are hashed in full, including generated/runtime files and symlink targets.
        if (parts.includes("oh_modules") || parts.includes("node_modules"))
          return false;
        if (
          parts.some((part) =>
            [
              ".hvigor",
              ".cache",
              ".idea",
              ".cxx",
              ".preview",
              "build",
              "dist",
              ".arkpilot",
            ].includes(part),
          )
        )
          return true;
        return (
          ignoredSources.some((prefix) => relative.startsWith(prefix)) &&
          path.extname(relative) === ".ets"
        );
      },
    );
    const receipt = receiptSchema.parse({
      format: 1,
      project_path: project.root,
      product: project.product.name,
      module_targets: projectTargets(project),
      inputs_sha256: inputs,
      model_sha256: fileDigest(
        path.join(project.root, ".hvigor/outputs/sync/output.json"),
      ),
      toolchain_sha256: digest(toolchain()),
      runtime_sha256: runtimeEvidenceIdentity().runtime_sha256,
      environment_sha256: digest(process.env),
    });
    return { available: true as const, receipt };
  } catch (error) {
    return { available: false as const, reason: errorResult(error) };
  }
}

export async function synchronizeProject(options: {
  store: StateStore;
  run_id: string;
  project: Project;
  policy: SyncPolicy;
  recovering?: boolean;
  install?: boolean;
  capture: () => ReturnType<typeof captureSyncReceipt>;
  synchronize: () => Promise<unknown>;
}) {
  const policy =
    typeof options.policy === "boolean"
      ? options.policy
        ? "force"
        : "skip"
      : options.policy;
  if (policy === "skip")
    return {
      skipped: true,
      policy,
      reason:
        "explicit caller choice; dependencies and model were not synchronized",
    };
  const started = performance.now(),
    before =
      policy === "auto" && !options.recovering
        ? options.capture()
        : { available: false as const };
  if (policy === "auto" && !options.recovering && before.available) {
    const candidates = options.store.db
      .prepare(
        `SELECT o.run_id,o.result FROM operations o JOIN runs r ON r.id=o.run_id
      WHERE o.node='sync_project' AND o.status='done' AND o.run_id<>?
      AND r.workflow IN ('project_sync','project_build','build_run','build_deploy_verify') ORDER BY r.updated DESC LIMIT 100`,
      )
      .all(options.run_id) as { run_id: string; result: string | null }[];
    for (const candidate of candidates) {
      try {
        const result = resolveEvidenceResult(
          options.store,
          JSON.parse(candidate.result ?? "null"),
        );
        if (result.skipped === true) continue;
        const receipt = receiptSchema.safeParse(result.sync_receipt);
        if (!receipt.success || digest(receipt.data) !== digest(before.receipt))
          continue;
        // Recheck current bytes before recording a retained dependency on the proof.
        const current = options.capture();
        if (
          !current.available ||
          digest(current.receipt) !== digest(receipt.data)
        )
          break;
        options.store.db
          .transaction(() => {
            invariant(
              options.store.db
                .prepare("SELECT 1 FROM runs WHERE id=?")
                .get(candidate.run_id),
              "SYNC_RECEIPT_UNAVAILABLE",
              "Historical sync was cleaned up",
            );
            invariant(
              options.store.db
                .prepare("SELECT 1 FROM runs WHERE id=?")
                .get(options.run_id),
              "RUN_NOT_FOUND",
              "Current run is missing",
            );
            options.store.db
              .prepare(
                "INSERT OR IGNORE INTO run_dependencies(parent_run_id,run_id) VALUES (?,?)",
              )
              .run(options.run_id, candidate.run_id);
          })
          .immediate();
        return {
          skipped: true,
          policy,
          reason:
            "current inputs and installed dependency bytes match a retained successful sync",
          reused_run_id: candidate.run_id,
          sync_receipt: receipt.data,
          decision_ms: performance.now() - started,
        };
      } catch {
        /* Retention cleanup or an unreadable historical result requires a fresh native sync. */
      }
    }
  }
  const decisionMs = performance.now() - started,
    result = await options.synchronize(),
    receiptStarted = performance.now();
  // Reconciliation may return an earlier command receipt. It must not certify a new cache identity.
  const after =
    !options.recovering && options.install !== false
      ? options.capture()
      : {
          available: false as const,
          reason: {
            code: "SYNC_RECEIPT_UNAVAILABLE",
            message:
              "Recovery or install=false does not create a reusable install receipt",
          },
        };
  return {
    ...z.record(z.string(), z.unknown()).parse(result),
    policy,
    skipped: false,
    decision_ms: decisionMs,
    receipt_ms: performance.now() - receiptStarted,
    sync_receipt: after.available ? after.receipt : null,
    reuse_unavailable: after.available ? null : after.reason,
  };
}
