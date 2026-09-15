import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { invariant } from "../core/errors.js";
import { digest, fileDigest, walk } from "../core/files.js";
import { packageRoot, protocolVersion, release } from "../core/config.js";
import { discoverToolchain } from "../core/toolchain.js";
import { inspectProject, projectTargets, type Project } from "./project.js";

/** Resume identity retains the native-7 definition; evidence additionally includes dependency locks. */
export function sourceHash(project: Project) {
  return digest(walk(project.root).filter(file => !file.includes(`${path.sep}.arkpilot${path.sep}`) && !["patch.json", "oh-package-lock.json5"].includes(path.basename(file)))
    .map(file => [path.relative(project.root, file), fileDigest(file)]));
}
export const evidenceIdentitySchema = z.object({
  format: z.literal(1), release: z.string(), protocol: z.string(), runtime_sha256: z.string(),
  resource_sha256: z.string(), dependency_lock_sha256: z.string(), upstream_lock_sha256: z.string(),
  project_path: z.string().optional(), product: z.string().optional(), module_targets: z.record(z.string(), z.string()).optional(),
  source_sha256: z.string().optional(), source_tree_sha256:z.string().optional(), configuration_sha256: z.string().optional(), project_dependencies_sha256: z.string().optional(),
  toolchain_sha256: z.string().optional(), scope_sha256: z.string(), requirements_sha256: z.string().optional(),
});
export type EvidenceIdentity = z.infer<typeof evidenceIdentitySchema>;
function treeIdentity(root: string) {
  return fs.existsSync(root) ? digest(walk(root).sort().map(file => [path.relative(root,file),fileDigest(file)])) : "unavailable";
}
export function runtimeEvidenceIdentity() {
  const hash = (name: string) => fs.existsSync(path.join(packageRoot,name)) ? fileDigest(path.join(packageRoot,name)) : "unavailable";
  return { format: 1 as const, release, protocol: protocolVersion,
    runtime_sha256: treeIdentity(path.join(packageRoot,"dist/src")),
    resource_sha256: treeIdentity(path.join(packageRoot,"resources")),
    dependency_lock_sha256: hash("package-lock.json"), upstream_lock_sha256: hash("provenance/upstream-lock.json") };
}
/** Evidence traversal includes symlink targets and nested package runtime files.
 * Bounded counts and cycle detection fail explicitly; no omitted dependency is called verified. */
export function inputTreeIdentity(root: string, ignored = new Set<string>(), exclude?: (relative: string) => boolean) {
  const rows: [string,string,string][] = [], active = new Set<string>();
  const visit = (file: string, relative: string) => {
    invariant(rows.length < 200000,"EVIDENCE_INPUT_LIMIT","Input tree exceeds 200000 entries; narrow the project scope before acceptance");
    const actual = fs.realpathSync.native(file), stat = fs.statSync(actual);
    if (stat.isDirectory()) {
      invariant(!active.has(actual),"EVIDENCE_INPUT_CYCLE","A dependency/source symlink forms a directory cycle");
      active.add(actual);
      rows.push([relative,actual,"directory"]);
      for (const item of fs.readdirSync(actual).sort()) if (!ignored.has(item) && !exclude?.(path.join(relative,item))) visit(path.join(actual,item),path.join(relative,item));
      active.delete(actual);
    } else {
      invariant(stat.isFile(),"EVIDENCE_INPUT_UNSUPPORTED","Input tree contains a non-regular file");
      const sha = fileDigest(actual), after = fs.statSync(actual);
      invariant(stat.size===after.size && stat.mtimeMs===after.mtimeMs && stat.ctimeMs===after.ctimeMs,"EVIDENCE_INPUT_CHANGED","Input changed during evidence hashing");
      rows.push([relative,actual,sha]);
    }
  };
  visit(root,"");
  return digest(rows);
}
export function projectEvidenceIdentity(project: Project) {
  // Hash resolved dependency content as well as declared locks. There is no result cache.
  const dependencies = ["oh_modules", "node_modules"].flatMap(name => {
    const root = path.join(project.root,name);
    return fs.existsSync(root) ? [[name, inputTreeIdentity(root,new Set([".git"]))]] : [];
  });
  const locks = walk(project.root).filter(file => /(?:^|[/\\])(?:oh-package-lock\.json5|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file)).sort().map(file => [path.relative(project.root,file),fileDigest(file)]);
  return { project_path: project.root, product: project.product.name, module_targets: projectTargets(project),
    source_sha256: sourceHash(project),
    source_tree_sha256:inputTreeIdentity(project.root,new Set(["node_modules","oh_modules",".git",".hvigor",".cache",".idea",".cxx",".preview","build","dist",".arkpilot","patch.json"])), configuration_sha256: project.fingerprint,
    project_dependencies_sha256: digest({dependencies,locks}) };
}
export function captureEvidenceIdentity(scope: { project_path?: string; product?: string; module_targets?: Record<string,string>; target?: string; app?: unknown; display_id?: number; window_id?: number }, requirements?: unknown, native = true): EvidenceIdentity {
  const project = scope.project_path ? inspectProject(scope.project_path,scope.product,scope.module_targets) : undefined;
  return evidenceIdentitySchema.parse({ ...runtimeEvidenceIdentity(), ...(project ? projectEvidenceIdentity(project) : {}),
    ...(native ? {toolchain_sha256: digest(discoverToolchain())} : {}),
    scope_sha256: digest(scope), ...(requirements !== undefined ? {requirements_sha256: digest(requirements)} : {}) });
}
export function compareEvidenceIdentity(recorded: EvidenceIdentity, current: EvidenceIdentity) {
  return Object.keys(recorded).filter(key => recorded[key as keyof EvidenceIdentity] !== undefined && digest(recorded[key as keyof EvidenceIdentity]) !== digest(current[key as keyof EvidenceIdentity] ?? null));
}
/** Historical receipts retain component digests, not a per-file input manifest. */
export function evidenceIdentityChanges(recorded: EvidenceIdentity, current: EvidenceIdentity) {
  return compareEvidenceIdentity(recorded, current).map(input => ({
    input,
    recorded: recorded[input as keyof EvidenceIdentity],
    current: current[input as keyof EvidenceIdentity] ?? null,
  }));
}
