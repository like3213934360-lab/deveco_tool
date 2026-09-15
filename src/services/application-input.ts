import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { appSchema, type ApplicationTarget } from "../core/contracts.js";
import { digest, readObject } from "../core/files.js";
import { invariant, object } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import { inspectProject, type Project } from "./project.js";
import { readPackageMetadata, inspectApplicationPackages } from "./package.js";
import {
  captureEvidenceIdentity,
  compareEvidenceIdentity,
  projectEvidenceIdentity,
} from "./evidence-identity.js";
import {
  evidenceArtifactSchema,
  evidenceSealSchema,
  resolveEvidenceResult,
  verifyEvidenceArtifacts,
} from "./evidence-result.js";

const moduleSchema = z.object({
  name: z.string(),
  type: z.string(),
  mainElement: z.string().optional(),
  abilities: z.array(z.object({ name: z.string() })).default([]),
});
function selectApplication(
  candidates: ApplicationTarget[],
  supplied?: ApplicationTarget,
) {
  const matching = supplied
    ? candidates.filter(
        (item) =>
          item.bundle_name === supplied.bundle_name &&
          (!supplied.module || item.module === supplied.module) &&
          item.ability === supplied.ability,
      )
    : candidates;
  invariant(
    matching.length === 1,
    matching.length ? "APPLICATION_AMBIGUOUS" : "APPLICATION_NOT_FOUND",
    "Select exactly one declared application component",
    { candidates },
  );
  return appSchema.parse({
    ...matching[0],
    ...supplied,
    module: matching[0]!.module,
  });
}
function components(
  bundle: string,
  module: z.infer<typeof moduleSchema>,
  supplied?: ApplicationTarget,
) {
  if (!["entry", "feature"].includes(module.type)) return [];
  // An explicit ability can select any declared UIAbility. Automatic selection
  // uses the declared mainElement, or the sole ability when none is declared.
  const abilities = supplied
    ? module.abilities
    : module.mainElement
      ? module.abilities.filter((item) => item.name === module.mainElement)
      : module.abilities;
  return abilities.map((item) => ({
    bundle_name: bundle,
    module: module.name,
    ability: item.name,
  }));
}
export function resolveProjectApplication(
  project: Project,
  supplied?: ApplicationTarget,
  modules?: string[],
) {
  const bundle = z
    .object({ app: z.object({ bundleName: z.string() }) })
    .parse(readObject(path.join(project.root, "AppScope/app.json5")))
    .app.bundleName;
  if (modules)
    invariant(
      modules.every((name) =>
        project.modules.some((item) => item.name === name),
      ),
      "MODULE_INVALID",
      "Unknown build module",
      { candidates: project.modules.map((item) => item.name) },
    );
  const candidates = project.modules
    .filter((item) => !modules || modules.includes(item.name))
    .flatMap((item) => {
      const module = moduleSchema.parse(
        readObject(path.join(item.root, "src/main/module.json5")).module,
      );
      return components(bundle, module, supplied);
    });
  return selectApplication(candidates, supplied);
}
export async function resolvePackageApplication(
  files: readonly string[],
  supplied?: ApplicationTarget,
  signal?: AbortSignal,
) {
  const candidates: ApplicationTarget[] = [];
  for (const file of files) {
    const metadata = await readPackageMetadata(file, signal);
    candidates.push(
      ...components(metadata.app.bundleName, metadata.module, supplied),
    );
  }
  const app = selectApplication(candidates, supplied);
  await inspectApplicationPackages(files, app, signal);
  return app;
}

/** A build reference is captured once, together with its original provenance.
 * It never grants an old build a newly supplied requirement binding. */
export function resolveBuildReference(
  store: StateStore,
  id: string,
  selection: {
    project_path?: string;
    product?: string;
    module_targets?: Record<string, string>;
  },
) {
  const run = store.get(id);
  invariant(
    run.status === "succeeded" &&
      ["project_build", "build_run", "build_deploy_verify"].includes(
        run.workflow,
      ),
    "BUILD_REFERENCE_INVALID",
    "Select a succeeded native build",
    { run_id: id, workflow: run.workflow, status: run.status },
  );
  const result = resolveEvidenceResult(
      store,
      run.result ? JSON.parse(run.result) : {},
    ),
    seal = evidenceSealSchema.parse(result._evidence);
  const scope = z
    .object({
      project_path: z.string(),
      product: z.string(),
      module_targets: z.record(z.string(), z.string()),
    })
    .parse(seal.scope);
  invariant(
    !selection.project_path ||
      fs.realpathSync.native(path.resolve(selection.project_path)) ===
        scope.project_path,
    "BUILD_INPUT_MISMATCH",
    "The build belongs to another project",
    { captured: scope },
  );
  invariant(
    !selection.product || selection.product === scope.product,
    "BUILD_INPUT_MISMATCH",
    "The build belongs to another product",
    { captured: scope },
  );
  invariant(
    !selection.module_targets ||
      Object.entries(selection.module_targets).every(
        ([name, target]) => scope.module_targets[name] === target,
      ),
    "BUILD_INPUT_MISMATCH",
    "The build used different module targets",
    { captured: scope },
  );
  const changed = compareEvidenceIdentity(
    seal.identity,
    captureEvidenceIdentity(
      seal.scope,
      seal.requirements,
      !!seal.identity.toolchain_sha256,
    ),
  );
  invariant(
    changed.length === 0,
    "BUILD_INPUT_STALE",
    "Build inputs changed; create a new build before deployment",
    { run_id: id, changed },
  );
  const build = resolveEvidenceResult(
    store,
    result[
      run.workflow === "project_build" ? "build_project" : "build_or_hot_apply"
    ] ?? {},
  );
  invariant(
    build.hot_reload !== true,
    "BUILD_REFERENCE_UNSUPPORTED",
    "A hot patch cannot be reused as a full installation",
  );
  const all = z.array(evidenceArtifactSchema).parse(build.artifacts ?? []);
  const artifacts = all.filter((item) => /-signed\.(hap|hsp)$/.test(item.path));
  invariant(
    artifacts.some((item) => item.path.endsWith(".hap")),
    "DEPLOY_ARTIFACT_MISSING",
    "The build must contain signed HAP packages and all required HSPs; HAR, APP and hot patches cannot be installed directly",
    {
      run_id: id,
      artifacts: all.map((item) => item.path),
    },
  );
  invariant(
    artifacts.every((item) =>
      seal.artifacts.some(
        (original) =>
          original.path === item.path && original.sha256 === item.sha256,
      ),
    ),
    "BUILD_REFERENCE_INVALID",
    "Build packages do not match their completion seal",
  );
  verifyEvidenceArtifacts(artifacts, store);
  const project = inspectProject(
    scope.project_path,
    scope.product,
    scope.module_targets,
  );
  invariant(
    digest(build.input_identity ?? null) ===
      digest(projectEvidenceIdentity(project)),
    "BUILD_INPUT_STALE",
    "Build command input identity is missing or no longer matches this project",
  );
  return {
    project,
    reference: {
      run_id: id,
      result_sha256: digest(result),
      identity: seal.identity,
      requirements: seal.requirements,
      artifacts,
      input_identity: object(build.input_identity ?? {}),
    },
  };
}
export type BuildReference = ReturnType<
  typeof resolveBuildReference
>["reference"];
