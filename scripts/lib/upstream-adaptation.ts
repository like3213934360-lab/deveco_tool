import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, digest, fileDigest, inside } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { candidate, candidateSchema, classify, tree, lockSchema, mappingSchema, sourceSchema, verifyCandidate } from "./upstream.js";
import { evidenceIdentity } from "./evidence.js";
import { release } from "../../src/core/config.js";
import { releaseScopeSchema } from "./release-scope.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const relative = z.string().min(1).refine((file) => !path.isAbsolute(file) && !file.includes("\\") && file.split("/").every((part) => !!part && part !== "." && part !== "..") && !/[\x00-\x1f]/.test(file));
export const adaptationSchema = z.strictObject({
  format: z.literal(1), candidate: candidateSchema,
  reviews: z.array(z.strictObject({ path: relative, decision: z.enum(["adapted", "unchanged", "excluded"]), reason: z.string().min(20), reviewer: z.string().min(1), targets: z.array(relative) })),
  files: z.array(z.strictObject({ path: relative, before_sha256: sha.nullable(), after_sha256: sha.nullable(), content: relative.optional() })).max(10000),
});
export function readJson(file: string): unknown {
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 * 1024, "UPSTREAM_INPUT_INVALID", "Adaptation metadata must be a regular file of at most 8 MiB");
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}
function configuration(root: string) {
  return { lock: lockSchema.parse(readJson(path.join(root, "provenance/upstream-lock.json"))), mapping: mappingSchema.parse(readJson(path.join(root, "provenance/upstream-mapping.json"))) };
}
function fileState(root: string, file: string) {
  const resolved = inside(root, file), stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  let parent = path.dirname(resolved);
  while (parent !== root) {
    const stat = fs.lstatSync(parent, { throwIfNoEntry: false });
    invariant(!stat || (stat.isDirectory() && !stat.isSymbolicLink()), "UPSTREAM_PATH_UNSAFE", "Adaptation paths cannot traverse symbolic links");
    parent = path.dirname(parent);
  }
  invariant(!stat || (stat.isFile() && !stat.isSymbolicLink()), "UPSTREAM_PATH_UNSAFE", "Adaptation targets must be regular files");
  return stat ? fileDigest(resolved) : null;
}
function targetIdentity(root: string, target: string): string {
  // Acceptance itself updates this file. Its semantic contents are bound
  // separately by the before/after source-lock transition in each receipt.
  if (target === "provenance/upstream-lock.json") return digest({ source_lock: "verified-separately" });
  const files: { path: string; sha256: string | null }[] = [];
  const visit = (relative: string, depth: number) => {
    invariant(depth <= 32 && files.length < 20000, "UPSTREAM_TARGET_LIMIT", "Mapped inventory exceeds its bounds");
    const file = inside(root, relative), stat = fs.lstatSync(file);
    invariant(!stat.isSymbolicLink(), "UPSTREAM_PATH_UNSAFE", "Mapped inventory cannot contain symbolic links");
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(`${relative.replace(/\/$/, "")}/${name}`, depth + 1);
    else files.push({ path: relative, sha256: fileState(root, relative) });
  };
  visit(target, 0);
  return digest(files);
}
export const baselineReviewSchema = z.strictObject({
  format: z.literal(1), source: sourceSchema, mapping_sha256: sha,
  reviews: z.array(z.strictObject({ rule: z.string().min(1), reason: z.string().min(20), reviewer: z.string().min(1) })).min(1),
  targets: z.array(z.strictObject({ path: relative, sha256: sha })).min(1),
  required_tests: z.array(relative).min(1),
});
function baselineInventory(root: string, sourceId: string) {
  const { lock, mapping } = configuration(root), source = lock.sources.find((item) => item.id === sourceId);
  invariant(source, "UPSTREAM_SOURCE_INVALID", "Unknown source");
  const rules = mapping.rules.filter((rule) => rule.source === sourceId);
  invariant(rules.length, "UPSTREAM_UNMAPPED", "Baseline requires explicit source mapping rules");
  const targets = [...new Set(rules.flatMap((rule) => [...rule.targets, ...rule.tests]))].sort();
  return { source, mapping_sha256: digest(mapping), rules, targets: targets.map((file) => ({ path: file, sha256: targetIdentity(root, file) })), required_tests: [...new Set(rules.flatMap((rule) => rule.tests))].sort() };
}
export async function prepareBaseline(root: string, repository: string, sourceId: string, output: string) {
  const inventory = baselineInventory(root, sourceId), { mapping } = configuration(root);
  // Verify origin and both locked Git objects without checking out or executing source.
  await candidate(inventory.source, repository, inventory.source.commit, mapping, root);
  // An unmapped catch-all is a deliberate guard for future new Skills. It is
  // not itself an unreviewed file in this pinned tree. Refuse actual files that
  // fall through to that guard, while retaining it for subsequent candidates.
  const files = await tree(repository, inventory.source.commit);
  invariant(!files.some((file) => classify(mapping, sourceId, file.path)?.disposition === "unmapped"), "UPSTREAM_UNMAPPED", "Pinned baseline contains an actual unclassified guarded path");
  invariant(!fs.existsSync(output), "OUTPUT_EXISTS", "Use a new baseline review file");
  const { rules, ...rest } = inventory;
  const template = { format: 1, ...rest, reviews: rules.map((rule) => ({ rule: rule.id, reason: rule.reason, reviewer: "" })) };
  atomicWrite(output, JSON.stringify(template, null, 2) + "\n", false);
  return { prepared: true, source: sourceId, rules: rules.length, acceptance: "pending" };
}
export function applyBaseline(root: string, raw: unknown) {
  const plan = baselineReviewSchema.parse(raw), fresh = baselineInventory(root, plan.source.id);
  invariant(digest(plan.source) === digest(fresh.source) && plan.mapping_sha256 === fresh.mapping_sha256 && digest(plan.targets) === digest(fresh.targets) && digest(plan.required_tests) === digest(fresh.required_tests), "UPSTREAM_BASELINE_CHANGED", "Baseline source, mapped files or required checks changed");
  invariant(new Set(plan.reviews.map((item) => item.rule)).size === plan.reviews.length && digest(plan.reviews.map((item) => item.rule).sort()) === digest(fresh.rules.map((item) => item.id).sort()), "UPSTREAM_REVIEW_INCOMPLETE", "Every source mapping requires a baseline review");
  const file = path.join(root, "provenance/upstream-baselines", plan.source.id, "review.json");
  if (fs.existsSync(file)) invariant(digest(readJson(file)) === digest(plan), "UPSTREAM_BASELINE_CONFLICT", "Another baseline review is already recorded");
  else atomicWrite(file, JSON.stringify(plan, null, 2) + "\n", false);
  return { reviewed: true, source: plan.source.id, acceptance: "pending", required_tests: plan.required_tests };
}

/** A deliberate new review round preserves the previous receipts. This also
 * rolls an accepted candidate into the next baseline before another upgrade.
 * Journal first and rename directories atomically so a retry resumes each move. */
export function refreshBaseline(root: string, raw: unknown) {
  const plan = baselineReviewSchema.parse(raw), fresh = baselineInventory(root, plan.source.id);
  invariant(digest(plan.source) === digest(fresh.source) && plan.mapping_sha256 === fresh.mapping_sha256 && digest(plan.targets) === digest(fresh.targets) && digest(plan.required_tests) === digest(fresh.required_tests), "UPSTREAM_BASELINE_CHANGED", "Refresh must review the currently locked source and final mapped files");
  invariant(new Set(plan.reviews.map((item) => item.rule)).size === plan.reviews.length && digest(plan.reviews.map((item) => item.rule).sort()) === digest(fresh.rules.map((item) => item.id).sort()), "UPSTREAM_REVIEW_INCOMPLETE", "Refresh requires a complete new mapping review");
  const baseline = path.join(root, "provenance/upstream-baselines", plan.source.id), candidateDir = path.join(root, "provenance/upstream-candidates", plan.source.id);
  const archive = path.join(root, "provenance/upstream-review-history", plan.source.id, digest(plan)), journalFile = path.join(archive, "refresh.json");
  const journalSchema = z.strictObject({ format: z.literal(1), plan_sha256: sha, baseline_sha256: sha, candidate_sha256: sha.nullable() });
  let journal: z.infer<typeof journalSchema>;
  if (fs.existsSync(journalFile)) journal = journalSchema.parse(readJson(journalFile));
  else {
    const previous = baselineReviewSchema.parse(readJson(path.join(baseline, "review.json")));
    invariant(digest(previous) !== digest(plan), "UPSTREAM_REVIEW_UNCHANGED", "Use the existing review and acceptance for unchanged input");
    let candidateHash: string | null = null;
    // A pending baseline can be corrected without discarding its pending
    // candidate. An accepted baseline may only advance past an accepted one.
    if (fs.existsSync(path.join(baseline, "accepted.json")) && fs.existsSync(candidateDir)) {
      invariant(fs.existsSync(path.join(candidateDir, "accepted.json")), "UPSTREAM_CANDIDATE_PENDING", "Accept the pending adaptation before starting another baseline round");
      const receipt = acceptedSchema.parse(readJson(path.join(candidateDir, "accepted.json")));
      invariant(digest(receipt.accepted_lock.sources.find((item) => item.id === plan.source.id)) === digest(plan.source), "UPSTREAM_LOCK_CHANGED", "Only the currently accepted candidate can be archived");
      verifyChecks(candidateDir, receipt, candidateSchema.parse(readJson(path.join(candidateDir, "candidate.json"))).required_tests);
      candidateHash = fileDigest(path.join(candidateDir, "adaptation.json"));
    }
    journal = { format: 1, plan_sha256: digest(plan), baseline_sha256: fileDigest(path.join(baseline, "review.json")), candidate_sha256: candidateHash };
    atomicWrite(journalFile, JSON.stringify(journal, null, 2) + "\n", false);
  }
  invariant(journal.plan_sha256 === digest(plan), "UPSTREAM_REVIEW_CHANGED", "Refresh retry must use the identical reviewed plan");
  const move = (from: string, name: string, identity: string, expected: string) => {
    const to = path.join(archive, name);
    if (fs.existsSync(to)) invariant(fileDigest(path.join(to, identity)) === expected, "UPSTREAM_HISTORY_CHANGED", "Archived review bytes changed");
    else {
      invariant(fileDigest(path.join(from, identity)) === expected, "UPSTREAM_REVIEW_CHANGED", "Review changed before archival");
      fs.renameSync(from, to);
    }
  };
  move(baseline, "baseline", "review.json", journal.baseline_sha256);
  if (journal.candidate_sha256) move(candidateDir, "candidate", "adaptation.json", journal.candidate_sha256);
  return { ...applyBaseline(root, plan), history: path.relative(root, archive).split(path.sep).join("/") };
}
export async function prepareAdaptation(root: string, repository: string, raw: unknown, output: string) {
  const { lock, mapping } = configuration(root), parsed = candidateSchema.parse(raw), source = lock.sources.find((item) => item.id === parsed.source);
  invariant(source, "UPSTREAM_SOURCE_INVALID", "Unknown source");
  const report = verifyCandidate(raw, source, mapping), reproduced = await candidate(source, repository, report.candidate.commit, mapping, root);
  invariant(reproduced.sha256 === report.sha256, "UPSTREAM_REPORT_CHANGED", "Candidate cannot be reproduced from the pinned Git objects");
  invariant(!fs.existsSync(output), "OUTPUT_EXISTS", "Use a new adaptation bundle directory");
  fs.mkdirSync(output, { recursive: true });
  const targets = [...new Set(report.changes.flatMap((item) => [...item.targets, ...item.tests]))].sort();
  const template = { format: 1, candidate: report, reviews: report.changes.map((item) => ({ path: item.path, decision: item.disposition === "exclude" ? "excluded" : "REVIEW_REQUIRED", reason: item.reason, reviewer: "", targets: item.targets })), files: [], baseline_targets: targets.map((file) => ({ path: file, sha256: fs.existsSync(inside(root, file)) && fs.statSync(inside(root, file)).isFile() ? fileState(root, file) : null })) };
  atomicWrite(path.join(output, "review-template.json"), JSON.stringify(template, null, 2) + "\n", false);
  atomicWrite(path.join(output, "README.md"), "# Candidate adaptation bundle\n\nReview each upstream change. Write plan.json using format, candidate, reviews and files from the template (omit baseline_targets). Decisions are adapted, unchanged or excluded. Every row requires a reviewer and a concrete reason. For each changed native file, record path, before_sha256, after_sha256 and content (a file relative to this bundle); deletion has null after_sha256 and no content. New files use null before_sha256. Do not copy executable upstream scripts or Skill definitions. The apply command checks hashes before writing and is resumable after partial writes. Run the mapped checks after application, then accept with their evidence manifest. The active lock stays at its old revision until acceptance.\n", false);
  return { output, report_sha256: report.sha256, unmapped: report.changes.filter((item) => item.disposition === "unmapped").length };
}
export function applyAdaptation(root: string, bundle: string, raw: unknown) {
  const plan = adaptationSchema.parse(raw), { lock, mapping } = configuration(root), source = lock.sources.find((item) => item.id === plan.candidate.source);
  invariant(source, "UPSTREAM_SOURCE_INVALID", "Unknown source");
  const report = verifyCandidate(plan.candidate, source, mapping);
  invariant(!report.changes.some((item) => item.disposition === "unmapped"), "UPSTREAM_UNMAPPED", "Classify every upstream change before adaptation");
  invariant(new Set(plan.reviews.map((item) => item.path)).size === plan.reviews.length && digest(plan.reviews.map((item) => item.path).sort()) === digest(report.changes.map((item) => item.path).sort()), "UPSTREAM_REVIEW_INCOMPLETE", "Every changed upstream path needs exactly one review");
  invariant(new Set(plan.files.map((item) => item.path)).size === plan.files.length, "UPSTREAM_DUPLICATE_FILE", "Native files must have unique operations");
  const mapped = [...new Set(report.changes.flatMap((item) => [...item.targets, ...item.tests]))];
  const covers = (file: string) => mapped.some((target) => file === target || file.startsWith(target.replace(/\/$/, "") + "/"));
  for (const review of plan.reviews) {
    const change = report.changes.find((item) => item.path === review.path)!;
    invariant(change.disposition === "exclude" ? review.decision === "excluded" : review.decision !== "excluded", "UPSTREAM_REVIEW_MISMATCH", "Review decision differs from the source mapping");
    invariant(review.targets.every((file) => [...change.targets, ...change.tests].some((target) => file === target || file.startsWith(target.replace(/\/$/, "") + "/"))), "UPSTREAM_TARGET_UNMAPPED", "Review points outside this change's mapped targets");
    if (review.decision === "adapted") invariant(review.targets.length > 0 && review.targets.some((target) => plan.files.some((item) => item.path === target || item.path.startsWith(target.replace(/\/$/, "") + "/"))), "UPSTREAM_ADAPTATION_MISSING", "An adapted change must include an actual mapped file change");
  }
  let total = 0;
  const pending = plan.files.map((item) => {
    invariant(covers(item.path) && !["provenance/upstream-lock.json", "package.json", "package-lock.json"].includes(item.path), "UPSTREAM_TARGET_UNMAPPED", "Native changes must be mapped; framework dependencies and source acceptance are separate");
    invariant(!/(?:^|\/)(?:SKILL(?:_[A-Z]+)?\.md|[^/]+\.(?:mjs|cjs))$/i.test(item.path) && !item.path.startsWith("skills/"), "UPSTREAM_RUNTIME_FORBIDDEN", "Do not restore retired runtimes or Skill installation");
    invariant(item.before_sha256 !== item.after_sha256, "UPSTREAM_EMPTY_EDIT", "File changes must change bytes");
    const current = fileState(root, item.path);
    invariant(current === item.before_sha256 || current === item.after_sha256, "UPSTREAM_TARGET_CHANGED", "Native file differs from both before and prepared hashes");
    if (item.after_sha256 === null) { invariant(!item.content, "UPSTREAM_CONTENT_INVALID", "Deletion has no content"); return { item, bytes: undefined }; }
    invariant(item.content, "UPSTREAM_CONTENT_MISSING", "Replacement requires content");
    invariant(fileState(bundle, item.content) === item.after_sha256, "UPSTREAM_CONTENT_CHANGED", "Prepared content digest differs");
    const file = inside(bundle, item.content), size = fs.statSync(file).size;
    invariant(size <= 16 * 1024 * 1024 && (total += size) <= 64 * 1024 * 1024, "UPSTREAM_CONTENT_TOO_LARGE", "Adaptation bundle exceeds bounded content limits");
    return { item, bytes: fs.readFileSync(file) };
  });
  const directory = path.join(root, "provenance/upstream-candidates", report.source), journal = path.join(directory, "adaptation.json");
  const receipt = { format: 1, plan_sha256: digest(plan), candidate_sha256: report.sha256, plan };
  if (fs.existsSync(journal)) invariant(digest(readJson(journal)) === digest(receipt), "UPSTREAM_ADAPTATION_CONFLICT", "A different adaptation is already recorded for this candidate");
  else atomicWrite(journal, JSON.stringify(receipt, null, 2) + "\n", false);
  for (const { item, bytes } of pending) {
    const current = fileState(root, item.path);
    invariant(current === item.before_sha256 || current === item.after_sha256, "UPSTREAM_TARGET_CHANGED", "Target changed before publication");
    if (current === item.after_sha256) continue;
    if (bytes) atomicWrite(inside(root, item.path), bytes, item.before_sha256 !== null);
    else fs.unlinkSync(inside(root, item.path));
  }
  atomicWrite(path.join(directory, "candidate.json"), JSON.stringify(report, null, 2) + "\n");
  return { applied: true, candidate: report.sha256, plan: digest(plan), acceptance: "pending", required_tests: report.required_tests };
}
const validationSchema = z.strictObject({ checks: z.array(z.strictObject({ check: relative, report: z.string().min(1), sha256: sha })).min(1) });
const identityFields = ["runtime_sha256", "compiled_sha256", "package_lock_sha256", "resource_manifest_sha256", "upstream_lock_sha256"] as const;
const publicIdentitySchema = z.object(Object.fromEntries(identityFields.map((key) => [key, sha])) as Record<typeof identityFields[number], typeof sha>);
const acceptedSchema = z.strictObject({
  format: z.literal(2), candidate_sha256: sha, adaptation_sha256: sha,
  evidence_sha256: sha, before_lock_sha256: sha, accepted_lock_sha256: sha,
  before_lock: lockSchema, accepted_lock: lockSchema,
  tested: publicIdentitySchema,
  checks: z.array(z.strictObject({ check: relative, report: relative, sha256: sha, original_sha256: sha })).min(1),
});

type Acceptance = z.infer<typeof acceptedSchema>;
function resumeLockTransition(root: string, lock: z.infer<typeof lockSchema>, receipt: Acceptance, sourceId: string) {
  const before = receipt.before_lock.sources.find((item) => item.id === sourceId), after = receipt.accepted_lock.sources.find((item) => item.id === sourceId), index = lock.sources.findIndex((item) => item.id === sourceId);
  invariant(before && after && index >= 0 && new Set(lock.sources.map((item) => item.id)).size === lock.sources.length, "UPSTREAM_SOURCE_INVALID", "Retry must identify exactly one source");
  invariant([digest(before), digest(after)].includes(digest(lock.sources[index])), "UPSTREAM_LOCK_CHANGED", "This source moved beyond the recorded transition");
  // Another source may have been accepted meanwhile. Never restore the entire
  // historical lock and thereby undo that independent acceptance.
  if (digest(lock.sources[index]) !== digest(after)) {
    invariant(digest(configuration(root).lock) === digest(lock), "UPSTREAM_LOCK_CHANGED", "Source lock changed during retry");
    lock.sources[index] = after;
    atomicWrite(path.join(root, "provenance/upstream-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  }
}
function acceptedTransition(receipt: Acceptance, sourceId: string, next: z.infer<typeof sourceSchema>) {
  const expected = structuredClone(receipt.before_lock), index = expected.sources.findIndex((item) => item.id === sourceId);
  invariant(index >= 0 && new Set(expected.sources.map((item) => item.id)).size === expected.sources.length, "UPSTREAM_SOURCE_INVALID", "Acceptance must identify one locked source");
  expected.sources[index] = next;
  invariant(digest(receipt.before_lock) === receipt.before_lock_sha256 && digest(receipt.accepted_lock) === receipt.accepted_lock_sha256 && digest(expected) === receipt.accepted_lock_sha256, "UPSTREAM_LOCK_CHANGED", "Acceptance may only apply the reviewed transition to its own source");
}
function verifyChecks(directory: string, receipt: Acceptance, required: readonly string[], root?: string) {
  invariant(new Set(receipt.checks.map((item) => item.check)).size === receipt.checks.length && required.every((check) => receipt.checks.some((item) => item.check === check)), "UPSTREAM_TEST_MISSING", "Each required check needs one accepted attestation");
  const currentAttestation = z.strictObject({ format: z.literal(1), passed: z.literal(true), tested: publicIdentitySchema, executed_tests: z.array(z.string()).length(1), original_sha256: sha });
  const carriedAttestation = z.strictObject({ format: z.literal(2), passed: z.literal(true), accepted_context: publicIdentitySchema, execution_tested: publicIdentitySchema, executed_tests: z.array(z.string()).length(1), original_sha256: sha, check_sha256: sha, prior_attestation_sha256: sha });
  for (const item of receipt.checks) {
    const file = inside(directory, item.report);
    invariant(fileDigest(file) === item.sha256, "UPSTREAM_EVIDENCE_CHANGED", "Published check attestation changed");
    const raw = readJson(file), carried = z.object({ format: z.number() }).parse(raw).format === 2;
    if (carried) {
      const result = carriedAttestation.parse(raw);
      invariant(root && result.original_sha256 === item.original_sha256 && digest(result.accepted_context) === digest(receipt.tested) && result.executed_tests[0] === `dist/${item.check.replace(/\.ts$/, ".js")}` && fileDigest(inside(root, item.check)) === result.check_sha256, "UPSTREAM_EVIDENCE_STALE", "Carried check must retain its execution identity and unchanged TypeScript source");
    } else {
      const result = currentAttestation.parse(raw);
      invariant(result.original_sha256 === item.original_sha256 && digest(result.tested) === digest(receipt.tested) && result.executed_tests[0] === `dist/${item.check.replace(/\.ts$/, ".js")}`, "UPSTREAM_EVIDENCE_STALE", "Check attestation differs from the accepted scope or bytes");
    }
  }
  invariant(receipt.evidence_sha256 === digest(receipt.checks.map(({ check, original_sha256 }) => ({ check, sha256: original_sha256 })).sort((a, b) => a.check.localeCompare(b.check))), "UPSTREAM_EVIDENCE_CHANGED", "Accepted evidence set differs from its journal");
}
function verifyBaseline(root: string, sourceId: string) {
  const directory = path.join(root, "provenance/upstream-baselines", sourceId), { mapping } = configuration(root);
  const plan = baselineReviewSchema.parse(readJson(path.join(directory, "review.json"))), receipt = acceptedSchema.parse(readJson(path.join(directory, "accepted.json")));
  const rules = mapping.rules.filter((item) => item.source === sourceId);
  invariant(plan.source.id === sourceId && plan.mapping_sha256 === digest(mapping) && rules.length > 0, "UPSTREAM_BASELINE_CHANGED", "Baseline must cover the current source mapping, including future-path guards");
  invariant(new Set(plan.reviews.map((item) => item.rule)).size === plan.reviews.length && digest(plan.reviews.map((item) => item.rule).sort()) === digest(rules.map((item) => item.id).sort()) && digest(plan.required_tests) === digest([...new Set(rules.flatMap((item) => item.tests))].sort()) && digest(plan.targets.map((item) => item.path)) === digest([...new Set(rules.flatMap((item) => [...item.targets, ...item.tests]))].sort()), "UPSTREAM_REVIEW_INCOMPLETE", "Baseline review must cover all mapped rules, files and checks");
  invariant(receipt.candidate_sha256 === digest(plan.source) && receipt.adaptation_sha256 === digest(plan) && digest(receipt.before_lock.sources.find((item) => item.id === sourceId)) === digest(plan.source), "UPSTREAM_ACCEPTANCE_CHANGED", "Baseline acceptance differs from the reviewed source");
  acceptedTransition(receipt, sourceId, { ...plan.source, acceptance: "verified" });
  verifyChecks(directory, receipt, plan.required_tests, root);
  return { plan, receipt };
}

/** Release and standalone gates share the same source acceptance checks. A
 * verified flag alone, or an empty candidate directory, is never acceptance. */
export function upstreamAcceptanceGate(root: string) {
  const { lock, mapping } = configuration(root), tested = evidenceIdentity(root);
  invariant(new Set(lock.sources.map((item) => item.id)).size === lock.sources.length, "UPSTREAM_SOURCE_INVALID", "Duplicate locked source");
  let candidates = 0;
  for (const source of lock.sources) {
    invariant(source.acceptance === "verified", "UPSTREAM_REVIEW_REQUIRED", "Every source requires a verified baseline");
    const baseline = verifyBaseline(root, source.id), directory = path.join(root, "provenance/upstream-candidates", source.id);
    let finalReceipt = baseline.receipt;
    if (fs.existsSync(directory)) {
      const report = candidateSchema.parse(readJson(path.join(directory, "candidate.json")));
      const saved = z.object({ plan_sha256: sha, plan: adaptationSchema }).parse(readJson(path.join(directory, "adaptation.json")));
      const receipt = acceptedSchema.parse(readJson(path.join(directory, "accepted.json"))), previous = receipt.before_lock.sources.find((item) => item.id === source.id);
      invariant(previous, "UPSTREAM_SOURCE_INVALID", "Candidate has no locked baseline");
      verifyCandidate(report, previous, mapping);
      invariant(!report.changes.some((item) => item.disposition === "unmapped") && receipt.candidate_sha256 === report.sha256 && saved.plan_sha256 === digest(saved.plan) && receipt.adaptation_sha256 === saved.plan_sha256 && saved.plan.candidate.sha256 === report.sha256, "UPSTREAM_ACCEPTANCE_CHANGED", "Candidate acceptance differs from its reviewed adaptation");
      invariant(previous.commit === baseline.plan.source.commit && previous.tree === baseline.plan.source.tree && previous.url === baseline.plan.source.url, "UPSTREAM_BASELINE_CHANGED", "Candidate must extend the accepted baseline");
      acceptedTransition(receipt, source.id, { ...previous, commit: report.candidate.commit, tree: report.candidate.tree, version: report.candidate.commit, acceptance: "verified" });
      verifyChecks(directory, receipt, report.required_tests, root);
      finalReceipt = receipt; candidates++;
    } else {
      for (const target of baseline.plan.targets) invariant(targetIdentity(root, target.path) === target.sha256, "UPSTREAM_BASELINE_CHANGED", "Mapped baseline changed after review");
    }
    invariant(digest(finalReceipt.accepted_lock.sources.find((item) => item.id === source.id)) === digest(source), "UPSTREAM_LOCK_CHANGED", "Locked source differs from accepted transition");
    invariant(identityFields.filter((key) => key !== "upstream_lock_sha256").every((key) => finalReceipt.tested[key] === tested[key]), "UPSTREAM_EVIDENCE_STALE", "Source acceptance must cover the current compiled runtime and resources");
  }
  for (const kind of ["upstream-candidates", "upstream-baselines"]) {
    const directory = path.join(root, "provenance", kind);
    for (const item of fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : []) invariant(item.isDirectory() && lock.sources.some((source) => source.id === item.name), "UPSTREAM_SOURCE_INVALID", "Acceptance directory contains an unknown source");
  }
  return { baseline_reports: lock.sources.length, candidate_reports: candidates, candidate_gate: "passed", release_ready: false };
}

/** Publish an allowlisted attestation, never the raw report (which can contain host
 * paths, device identities, logs and credentials). Keep the original digest for audit. */
function recordChecks(directory: string, raw: unknown, required: readonly string[], tested: ReturnType<typeof evidenceIdentity>, requireAll = true) {
  const evidence = validationSchema.parse(raw);
  invariant(new Set(evidence.checks.map((item) => item.check)).size === evidence.checks.length, "UPSTREAM_TEST_DUPLICATE", "Each mapped check must occur once");
  if (requireAll) for (const check of required) invariant(evidence.checks.some((item) => item.check === check), "UPSTREAM_TEST_MISSING", `Required evidence missing: ${check}`);
  else for (const item of evidence.checks) invariant(required.includes(item.check), "UPSTREAM_TEST_UNEXPECTED", `Evidence is not mapped for this baseline: ${item.check}`);
  const identity = publicIdentitySchema.parse(tested);
  const pending = evidence.checks.map((item) => {
    invariant(fileDigest(item.report) === item.sha256, "UPSTREAM_EVIDENCE_CHANGED", "Validation report digest differs");
    const result = z.object({ passed: z.boolean().optional(), status: z.string().optional(), executed_tests: z.array(z.string()).optional(), identity: z.record(z.string(), z.unknown()).optional(), tested: z.record(z.string(), z.unknown()).optional() }).parse(readJson(item.report));
    invariant(fileDigest(item.report) === item.sha256, "UPSTREAM_EVIDENCE_CHANGED", "Validation report changed during capture");
    invariant(result.passed === true || result.status === "passed", "UPSTREAM_TEST_FAILED", "Validation report did not pass");
    const actual = result.tested ?? result.identity, compiledCheck = `dist/${item.check.replace(/\.ts$/, ".js")}`;
    invariant(actual?.entrypoint === compiledCheck || result.executed_tests?.includes(compiledCheck), "UPSTREAM_EVIDENCE_SCOPE", "Validation report did not execute the declared mapped check");
    invariant(actual && identityFields.every((key) => actual[key] === tested[key]), "UPSTREAM_EVIDENCE_STALE", "Validation must cover current compiled code, resources and source locks");
    const content = JSON.stringify({ format: 1, passed: true, tested: identity, executed_tests: [compiledCheck], original_sha256: item.sha256 }, null, 2) + "\n";
    const hash = digest({ content }), destination = `checks/${hash}.json`;
    return { item, content, destination };
  });
  return pending.map(({ item, content, destination }) => {
    const file = path.join(directory, destination);
    if (fs.existsSync(file)) invariant(fs.readFileSync(file, "utf8") === content, "UPSTREAM_EVIDENCE_CHANGED", "Published attestation changed");
    else atomicWrite(file, content, false);
    return { check: item.check, report: destination, sha256: fileDigest(file), original_sha256: item.sha256 };
  });
}

function carryForwardBaselineChecks(root: string, directory: string, sourceId: string, plan: z.infer<typeof baselineReviewSchema>, required: readonly string[], tested: ReturnType<typeof evidenceIdentity>) {
  if (!required.length) return [];
  const scope = releaseScopeSchema.parse(readJson(path.join(root, `provenance/release-scope-${release}.json`)));
  for (const check of required) invariant(scope.upstream_historical_checks.includes(check), "UPSTREAM_TEST_MISSING", `Current evidence missing and release scope does not authorize historical carry-forward: ${check}`);
  const historyRoot = path.join(root, "provenance/upstream-review-history", sourceId);
  const histories = fs.readdirSync(historyRoot).sort().reverse();
  return required.map((check) => {
    for (const history of histories) {
      const priorDirectory = path.join(historyRoot, history, "baseline"), reviewFile = path.join(priorDirectory, "review.json"), receiptFile = path.join(priorDirectory, "accepted.json");
      if (!fs.existsSync(reviewFile) || !fs.existsSync(receiptFile)) continue;
      const priorPlan = baselineReviewSchema.parse(readJson(reviewFile)), prior = acceptedSchema.parse(readJson(receiptFile));
      const before = priorPlan.targets.find((item) => item.path === check), after = plan.targets.find((item) => item.path === check), item = prior.checks.find((candidate) => candidate.check === check);
      if (!before || !after || before.sha256 !== after.sha256 || !item) continue;
      verifyChecks(priorDirectory, prior, priorPlan.required_tests, root);
      const priorRaw = z.strictObject({ format: z.literal(1), passed: z.literal(true), tested: publicIdentitySchema, executed_tests: z.array(z.string()).length(1), original_sha256: sha }).parse(readJson(path.join(priorDirectory, item.report)));
      const content = JSON.stringify({ format: 2, passed: true, accepted_context: publicIdentitySchema.parse(tested), execution_tested: priorRaw.tested, executed_tests: priorRaw.executed_tests, original_sha256: item.original_sha256, check_sha256: fileDigest(inside(root, check)), prior_attestation_sha256: item.sha256 }, null, 2) + "\n";
      const destination = `checks/${digest({ content })}.json`, file = path.join(directory, destination);
      if (fs.existsSync(file)) invariant(fs.readFileSync(file, "utf8") === content, "UPSTREAM_EVIDENCE_CHANGED", "Carried attestation changed");
      else atomicWrite(file, content, false);
      return { check, report: destination, sha256: fileDigest(file), original_sha256: item.original_sha256 };
    }
    invariant(false, "UPSTREAM_HISTORICAL_EVIDENCE_MISSING", `No accepted unchanged historical check exists for ${check}`);
  });
}

export function acceptAdaptation(root: string, sourceId: string, raw: unknown) {
  const { lock, mapping } = configuration(root), source = lock.sources.find((item) => item.id === sourceId);
  invariant(source, "UPSTREAM_SOURCE_INVALID", "Unknown source");
  const directory = path.join(root, "provenance/upstream-candidates", source.id), saved = z.object({ plan_sha256: sha, plan: adaptationSchema }).parse(readJson(path.join(directory, "adaptation.json"))), plan = saved.plan;
  invariant(digest(plan) === saved.plan_sha256, "UPSTREAM_ADAPTATION_CHANGED", "Adaptation journal changed");
  for (const item of plan.files) invariant(fileState(root, item.path) === item.after_sha256, "UPSTREAM_ADAPTATION_CHANGED", "Adapted file changed before acceptance");
  const acceptedPath = path.join(directory, "accepted.json"), evidence = validationSchema.parse(raw);
  // Paths are deliberately excluded so immutable original reports may be relocated.
  const evidenceHash = digest(evidence.checks.map(({ check, sha256 }) => ({ check, sha256 })).sort((a, b) => a.check.localeCompare(b.check)));
  const tested = evidenceIdentity(root);
  if (fs.existsSync(acceptedPath)) {
    const prior = acceptedSchema.parse(readJson(acceptedPath));
    invariant(prior.adaptation_sha256 === saved.plan_sha256 && prior.candidate_sha256 === plan.candidate.sha256 && prior.evidence_sha256 === evidenceHash, "UPSTREAM_ACCEPTANCE_CONFLICT", "Acceptance journal belongs to another plan or evidence set");
    const beforeSource = prior.before_lock.sources.find((item) => item.id === sourceId);
    invariant(beforeSource, "UPSTREAM_SOURCE_INVALID", "Journal has no original source");
    const report = verifyCandidate(plan.candidate, beforeSource, mapping);
    acceptedTransition(prior, sourceId, { ...beforeSource, commit: report.candidate.commit, tree: report.candidate.tree, version: report.candidate.commit, acceptance: "verified" });
    verifyChecks(directory, prior, report.required_tests, root);
    invariant(identityFields.filter((key) => key !== "upstream_lock_sha256").every((key) => prior.tested[key] === tested[key]), "UPSTREAM_EVIDENCE_STALE", "Accepted runtime changed; fresh validation is required");
    for (const item of evidence.checks) invariant(fileDigest(item.report) === item.sha256, "UPSTREAM_EVIDENCE_CHANGED", "Original validation report changed");
    for (const item of prior.checks) invariant(fileDigest(inside(directory, item.report)) === item.sha256, "UPSTREAM_EVIDENCE_CHANGED", "Published attestation changed");
    for (const required of report.required_tests) invariant(prior.checks.some((item) => item.check === required), "UPSTREAM_TEST_MISSING", "Journal lacks a required check");
    resumeLockTransition(root, lock, prior, sourceId);
    return { accepted: true, source: sourceId, commit: report.candidate.commit, deduplicated: true, release_ready: false };
  }
  const report = verifyCandidate(plan.candidate, source, mapping);
  const records = recordChecks(directory, evidence, report.required_tests, tested);
  const beforeLock = structuredClone(lock);
  source.commit = report.candidate.commit; source.tree = report.candidate.tree; source.version = source.commit; source.acceptance = "verified";
  const receipt = acceptedSchema.parse({ format: 2, candidate_sha256: report.sha256, adaptation_sha256: saved.plan_sha256, evidence_sha256: evidenceHash, before_lock_sha256: digest(beforeLock), accepted_lock_sha256: digest(lock), before_lock: beforeLock, accepted_lock: lock, tested: publicIdentitySchema.parse(tested), checks: records });
  atomicWrite(acceptedPath, JSON.stringify(receipt, null, 2) + "\n", false);
  invariant(digest(configuration(root).lock) === digest(beforeLock), "UPSTREAM_LOCK_CHANGED", "Source lock changed before acceptance commit");
  atomicWrite(path.join(root, "provenance/upstream-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  return { accepted: true, source: source.id, commit: source.commit, deduplicated: false, release_ready: false };
}

export function acceptBaseline(root: string, sourceId: string, raw: unknown) {
  const directory = path.join(root, "provenance/upstream-baselines", sourceId);
  const plan = baselineReviewSchema.parse(readJson(path.join(directory, "review.json")));
  const { lock, mapping } = configuration(root), source = lock.sources.find((item) => item.id === sourceId);
  invariant(source && source.commit === plan.source.commit && source.tree === plan.source.tree && source.url === plan.source.url && digest(mapping) === plan.mapping_sha256, "UPSTREAM_BASELINE_CHANGED", "Reviewed baseline no longer matches source or mappings");
  for (const item of plan.targets) invariant(targetIdentity(root, item.path) === item.sha256, "UPSTREAM_BASELINE_CHANGED", "Mapped baseline code changed; review the final implementation");
  const evidence = validationSchema.parse(raw), tested = evidenceIdentity(root), receiptPath = path.join(directory, "accepted.json");
  if (fs.existsSync(receiptPath)) {
    const prior = acceptedSchema.parse(readJson(receiptPath));
    const supplied = new Map(evidence.checks.map((item) => [item.check, item.sha256]));
    const evidenceHash = digest(prior.checks.map(({ check, original_sha256 }) => ({ check, sha256: supplied.get(check) ?? original_sha256 })).sort((a, b) => a.check.localeCompare(b.check)));
    invariant(prior.adaptation_sha256 === digest(plan) && prior.evidence_sha256 === evidenceHash, "UPSTREAM_ACCEPTANCE_CONFLICT", "Baseline retry differs from recorded acceptance");
    invariant(identityFields.filter((key) => key !== "upstream_lock_sha256").every((key) => tested[key] === prior.tested[key]), "UPSTREAM_EVIDENCE_STALE", "Accepted code or resources changed");
    acceptedTransition(prior, sourceId, { ...plan.source, acceptance: "verified" });
    verifyChecks(directory, prior, plan.required_tests, root);
    for (const item of evidence.checks) invariant(fileDigest(item.report) === item.sha256, "UPSTREAM_EVIDENCE_CHANGED", "Original report changed");
    for (const item of prior.checks) invariant(fileDigest(inside(directory, item.report)) === item.sha256, "UPSTREAM_EVIDENCE_CHANGED", "Attestation changed");
    resumeLockTransition(root, lock, prior, sourceId);
    return { accepted: true, source: sourceId, deduplicated: true, release_ready: false };
  }
  const records = recordChecks(directory, evidence, plan.required_tests, tested, false);
  const missing = plan.required_tests.filter((check) => !records.some((item) => item.check === check));
  records.push(...carryForwardBaselineChecks(root, directory, sourceId, plan, missing, tested));
  const evidenceHash = digest(records.map(({ check, original_sha256 }) => ({ check, sha256: original_sha256 })).sort((a, b) => a.check.localeCompare(b.check)));
  const before = structuredClone(lock);
  source.acceptance = "verified";
  const receipt = acceptedSchema.parse({ format: 2, candidate_sha256: digest(plan.source), adaptation_sha256: digest(plan), evidence_sha256: evidenceHash, before_lock_sha256: digest(before), accepted_lock_sha256: digest(lock), before_lock: before, accepted_lock: lock, tested: publicIdentitySchema.parse(tested), checks: records });
  atomicWrite(receiptPath, JSON.stringify(receipt, null, 2) + "\n", false);
  invariant(digest(configuration(root).lock) === digest(before), "UPSTREAM_LOCK_CHANGED", "Source lock changed before baseline acceptance commit");
  atomicWrite(path.join(root, "provenance/upstream-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  return { accepted: true, source: sourceId, deduplicated: false, release_ready: false };
}
