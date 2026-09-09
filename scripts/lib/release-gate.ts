import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { release, protocolVersion } from "../../src/core/config.js";
import { digest, fileDigest, inside } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { auditMigration } from "./migration.js";
import { verifyMigrationEvidence } from "./migration-acceptance.js";
import { evidenceIdentity } from "./evidence.js";
import { readJson, upstreamAcceptanceGate } from "./upstream-adaptation.js";
import { validateSoak } from "./soak-gate.js";
import { validatePerformance } from "./performance-gate.js";
import { verifyDistribution } from "./distribution.js";

import { requiredAcceptance } from "./acceptance-requirements.js";
export { requiredAcceptance, requiredPerformance } from "./acceptance-requirements.js";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.strictObject({ file: z.string().min(1), sha256: sha });
const identitySchema = z.object({ runtime_sha256: sha, compiled_sha256: sha, package_lock_sha256: sha, resource_manifest_sha256: sha, upstream_lock_sha256: sha });
export const releaseManifestSchema = z.strictObject({
  format: z.literal(1), release: z.literal(release), protocol: z.literal(protocolVersion),
  regression: z.array(reference).length(6), installation: z.array(reference).length(6),
  acceptance: z.array(reference).min(1), performance: reference, soak: reference,
  distribution: z.string().min(1), distribution_sha256: sha,
});
function rawReference(root: string, ref: z.infer<typeof reference>) {
  const file = inside(root, ref.file);
  invariant(fileDigest(file) === ref.sha256, "RELEASE_EVIDENCE_CHANGED", `Evidence digest differs: ${ref.file}`);
  return readJson(file);
}
function sameIdentity(raw: unknown, expected: ReturnType<typeof evidenceIdentity>) {
  const actual = identitySchema.parse(raw);
  invariant(Object.entries(actual).every(([key, value]) => value === expected[key as keyof typeof expected]), "RELEASE_EVIDENCE_STALE", "Evidence must cover the final compiled runtime, tests, lock and resources");
}
function matrixKey(platform: string, node: string) {
  const version = /^v?(22|24)\.(\d+)\.(\d+)$/.exec(node), major = version?.[1];
  invariant(["darwin", "linux", "win32"].includes(platform) && version && (major === "24" || Number(version[2]) >= 18), "RELEASE_PLATFORM_UNSUPPORTED", "Expected macOS/Windows/Linux on Node 22/24");
  return `${platform}:${major}`;
}
function completeMatrix(keys: string[]) {
  invariant(new Set(keys).size === 6, "RELEASE_MATRIX_INCOMPLETE", "Every OS and Node combination requires distinct passing evidence");
}
export function releaseGate(root: string, evidenceRoot: string, raw: unknown) {
  const manifest = releaseManifestSchema.parse(raw), tested = evidenceIdentity(root), matrix = auditMigration(root);
  invariant(matrix.release_ready, "RELEASE_MIGRATION_INCOMPLETE", "Every migration row needs current behavior acceptance before release");
  verifyMigrationEvidence(root);
  upstreamAcceptanceGate(root);
  for (const directory of ["src", "scripts", "test"]) {
    const visit = (relative: string) => {
      for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const file = `${relative}/${item.name}`;
        invariant(!item.isSymbolicLink(), "RELEASE_SOURCE_SYMLINK", "Own code cannot be selected through symbolic links");
        if (item.isDirectory()) visit(file);
        else invariant(!/\.(?:mjs|cjs|js)$/.test(file), "RELEASE_LEGACY_RUNTIME", `Retired own source remains: ${file}`);
      }
    }; visit(directory);
  }
  invariant(!fs.existsSync(path.join(root, "skills")) || fs.readdirSync(path.join(root, "skills")).length === 0, "RELEASE_SKILLS_REMAIN", "Installed Skill source directory must be removed");
  const dependencyLock = fs.readFileSync(path.join(root, "package-lock.json"), "utf8");
  invariant(!/@deveco\/deveco-cli|@deveco-codegenie\/mcp/.test(dependencyLock), "RELEASE_LEGACY_DEPENDENCY", "Official CLI/child MCP cannot remain in the lock");
  const regression = manifest.regression.map((ref) => {
    const report = z.object({ passed: z.literal(true), tests: z.number().int().positive(), pass: z.number().int().positive(), fail: z.literal(0), skipped: z.literal(0), cancelled: z.literal(0), todo: z.literal(0), identity: identitySchema.extend({ platform: z.string(), node: z.string() }) }).parse(rawReference(evidenceRoot, ref));
    invariant(report.tests === report.pass, "RELEASE_REGRESSION_INCOMPLETE", "Every collected test must pass"); sameIdentity(report.identity, tested);
    return matrixKey(report.identity.platform, report.identity.node);
  }); completeMatrix(regression);
  const distribution = inside(evidenceRoot, manifest.distribution), verified = verifyDistribution(distribution);
  invariant(fileDigest(path.join(distribution, "distribution.json")) === manifest.distribution_sha256, "RELEASE_DISTRIBUTION_CHANGED", "Distribution manifest changed");
  const installedRuntime = z.object({ files: z.array(z.object({ file: z.string(), sha256: sha })) }).parse(readJson(path.join(distribution, "distribution.json"))).files.filter((item) => /^dist\/src\/.*\.js$/.test(item.file)).map(({ file, sha256 }) => ({ file, sha256 })).sort((a, b) => a.file.localeCompare(b.file));
  invariant(digest(installedRuntime) === tested.runtime_sha256, "RELEASE_PACKAGE_STALE", "Packaged runtime differs from the accepted runtime");
  completeMatrix(manifest.installation.map((ref) => {
    const report = z.object({ passed: z.literal(true), platform: z.string(), node: z.string(), identity: z.object({ manifest_sha256: sha }), closed: z.literal(true), results: z.array(z.object({ passed: z.literal(true) }).passthrough()).min(1) }).parse(rawReference(evidenceRoot, ref));
    invariant(report.identity.manifest_sha256 === verified.manifest_sha256, "RELEASE_INSTALLATION_STALE", "Clean install evidence refers to a different archive");
    return matrixKey(report.platform, report.node);
  }));
  const cases = new Set<string>();
  for (const ref of manifest.acceptance) {
    const report = z.object({ tested: identitySchema, passed: z.literal(true), scope: z.string().min(1), cases: z.array(z.object({ id: z.enum(requiredAcceptance), passed: z.literal(true), artifacts: z.array(reference).min(1) })).min(1) }).parse(rawReference(evidenceRoot, ref));
    sameIdentity(report.tested, tested);
    for (const item of report.cases) {
      for (const artifact of item.artifacts) invariant(fileDigest(inside(evidenceRoot, artifact.file)) === artifact.sha256, "RELEASE_ARTIFACT_CHANGED", "Acceptance artifact changed");
      cases.add(item.id);
    }
  }
  invariant(requiredAcceptance.every((id) => cases.has(id)), "RELEASE_ACCEPTANCE_MISSING", `Missing acceptance: ${requiredAcceptance.filter((id) => !cases.has(id)).join(", ")}`);
  const performance = validatePerformance(rawReference(evidenceRoot, manifest.performance));
  sameIdentity(performance.tested, tested);
  const soak = validateSoak(rawReference(evidenceRoot, manifest.soak));
  sameIdentity(soak.tested, tested);
  return { passed: true, release, protocol: protocolVersion, tested, manifest_sha256: digest(manifest), distribution_sha256: manifest.distribution_sha256, regression, acceptance_cases: cases.size, performance_observations: performance.observations };
}
