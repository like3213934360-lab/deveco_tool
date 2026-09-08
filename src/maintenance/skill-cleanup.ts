import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { packageRoot } from "../core/config.js";
import { atomicWrite, digest, fileDigest } from "../core/files.js";
import { invariant } from "../core/errors.js";

const nameSchema = z.string().regex(/^[a-z0-9-]+$/);
const markerSchema = z.object({ packRoot: z.string(), host: z.enum(["codex", "claude"]), installed: z.array(z.object({ name: nameSchema, mode: z.enum(["symlink", "copy"]) })) });
const identity = (file: string) => {
  const stat = fs.lstatSync(file);
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
};
function inventory(directory: string, allowedEmptyDirectories: readonly string[] = []): Record<string, string> {
  const files: Record<string, string> = {}, directories: string[] = []; let count = 0, bytes = 0;
  const visit = (relative: string, depth: number) => {
    invariant(depth <= 12 && ++count <= 1000, "SKILL_INVENTORY_LIMIT", "Installed Skill exceeds inventory limits");
    const file = path.join(directory, relative), stat = fs.lstatSync(file);
    invariant(!stat.isSymbolicLink(), "SKILL_COPY_UNSAFE", "Copied Skill contains a symbolic link");
    if (stat.isDirectory()) {
      directories.push(relative);
      for (const name of fs.readdirSync(file).sort()) visit(relative ? `${relative}/${name}` : name, depth + 1);
    }
    else {
      invariant(stat.isFile() && (bytes += stat.size) <= 16 * 1024 * 1024, "SKILL_COPY_UNSAFE", "Copied Skill contains a special or oversized file");
      files[relative] = fileDigest(file);
    }
  };
  visit("", 0);
  invariant(directories.every((directory) => directory === "" || allowedEmptyDirectories.includes(directory) || Object.keys(files).some((file) => file.startsWith(directory + "/"))), "SKILL_COPY_CHANGED", "Unexpected empty directory is a user modification");
  return files;
}
export function planSkillCleanup(hostDirectory: string, packRoot: string) {
  const directory = fs.realpathSync.native(path.resolve(hostDirectory)), source = path.resolve(packRoot), marker = path.join(directory, ".deveco-tool-host.json");
  invariant(fs.lstatSync(marker).isFile() && !fs.lstatSync(marker).isSymbolicLink() && fs.statSync(marker).size <= 65536, "SKILL_MARKER_INVALID", "A regular installation ownership marker is required");
  const record = markerSchema.parse(JSON.parse(fs.readFileSync(marker, "utf8")) as unknown);
  invariant(path.resolve(record.packRoot) === source, "SKILL_OWNER_MISMATCH", "Marker does not belong to the selected old installation");
  const known = z.object({ installations: z.array(z.object({ name: nameSchema, host: z.enum(["plain", "codex", "claude"]), files: z.record(z.string(), z.string()) })) }).parse(JSON.parse(fs.readFileSync(path.join(packageRoot, "provenance/installed-skill-fingerprints.json"), "utf8")) as unknown);
  invariant(new Set(record.installed.map((item) => item.name)).size === record.installed.length, "SKILL_MARKER_INVALID", "Duplicate installed Skill names");
  const entries = record.installed.map((entry) => {
    const file = path.join(directory, entry.name), stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return { ...entry, path: file, disposition: "absent" as const };
    try {
      if (entry.mode === "symlink") {
        invariant(stat.isSymbolicLink() && path.resolve(path.dirname(file), fs.readlinkSync(file)) === path.join(source, "skills", entry.name), "SKILL_LINK_CHANGED", "Skill link no longer points to the recorded installation");
        const target = path.join(source, "skills", entry.name), targetStat = fs.lstatSync(target, { throwIfNoEntry: false });
        let targetFiles: Record<string, string> | null = null;
        if (targetStat) {
          invariant(targetStat.isDirectory() && !targetStat.isSymbolicLink(), "SKILL_LINK_CHANGED", "Linked Skill target changed type");
          targetFiles = inventory(target);
          invariant(known.installations.some((item) => item.name === entry.name && (item.host === record.host || item.host === "plain") && digest(item.files) === digest(targetFiles)), "SKILL_LINK_CHANGED", "Linked Skill content was modified; retain user changes");
        }
        // An owned broken link has no remaining content to delete. Only the
        // exact link is removed, never its former source directory.
        return { ...entry, path: file, disposition: "remove" as const, identity: identity(file), link: fs.readlinkSync(file), target_files: targetFiles };
      }
      invariant(stat.isDirectory() && !stat.isSymbolicLink(), "SKILL_COPY_CHANGED", "Installed copy is no longer a regular directory");
      const files = inventory(file);
      invariant(known.installations.some((item) => item.name === entry.name && (item.host === record.host || item.host === "plain") && digest(item.files) === digest(files)), "SKILL_COPY_CHANGED", "Installed copy differs from known installer output; retain user changes");
      return { ...entry, path: file, disposition: "remove" as const, identity: identity(file), files };
    } catch (error) { return { ...entry, path: file, disposition: "retain" as const, reason: error instanceof Error ? error.message : "Ownership could not be verified" }; }
  });
  const plan = { format: 1, directory, source, marker_sha256: fileDigest(marker), entries };
  return { ...plan, sha256: digest(plan) };
}
export function applySkillCleanup(raw: unknown) {
  const candidate = z.object({ directory: z.string(), source: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).parse(raw);
  invariant(fs.realpathSync.native(candidate.directory) === candidate.directory && !fs.lstatSync(candidate.directory).isSymbolicLink(), "SKILL_PLAN_CHANGED", "Host Skill directory changed identity or became a link");
  const journalFile = path.join(candidate.directory, `.deveco-tool-cleanup-${candidate.sha256}.json`);
  type Plan = ReturnType<typeof planSkillCleanup>;
  type Journal = { format: 1; plan: Plan; started: string[]; removed: string[]; after_marker_sha256?: string };
  let journal: Journal;
  if (fs.existsSync(journalFile)) {
    invariant(fs.lstatSync(journalFile).isFile() && !fs.lstatSync(journalFile).isSymbolicLink(), "SKILL_JOURNAL_INVALID", "Cleanup journal must be a regular file");
    journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as Journal;
    invariant(journal.format === 1 && digest(journal.plan) === digest(raw) && Array.isArray(journal.started) && Array.isArray(journal.removed), "SKILL_JOURNAL_CHANGED", "Cleanup journal differs from the approved plan");
    const { sha256, ...payload } = journal.plan;
    invariant(digest(payload) === sha256, "SKILL_PLAN_CHANGED", "Cleanup plan digest differs");
  } else {
    const fresh = planSkillCleanup(candidate.directory, candidate.source);
    invariant(digest(raw) === digest(fresh) && candidate.sha256 === fresh.sha256, "SKILL_PLAN_CHANGED", "Installed files or marker changed after planning");
    journal = { format: 1, plan: fresh, started: [], removed: [] };
    atomicWrite(journalFile, JSON.stringify(journal, null, 2) + "\n", false);
  }
  const fresh = journal.plan, marker = path.join(fresh.directory, ".deveco-tool-host.json");
  const save = () => atomicWrite(journalFile, JSON.stringify(journal, null, 2) + "\n");
  const removals = fresh.entries.filter((entry) => entry.disposition === "remove");
  invariant(journal.started.every((name) => removals.some((entry) => entry.name === name)) && journal.removed.every((name) => journal.started.includes(name)), "SKILL_JOURNAL_CHANGED", "Journal contains unplanned removal names");
  if (journal.after_marker_sha256) {
    invariant(fileDigest(marker) === journal.after_marker_sha256 && removals.every((entry) => !fs.lstatSync(entry.path, { throwIfNoEntry: false })), "SKILL_PLAN_CHANGED", "Completed cleanup marker or removed entry changed");
    return { removed: removals.map((entry) => entry.path), retained: fresh.entries.filter((entry) => entry.disposition === "retain"), deduplicated: true };
  }
  const original = markerSchema.parse(JSON.parse(fs.readFileSync(marker, "utf8")) as unknown);
  const remaining = { ...original, installed: original.installed.filter((item) => fresh.entries.some((entry) => entry.name === item.name && entry.disposition === "retain")) };
  const after = JSON.stringify(remaining, null, 2) + "\n";
  const markerBefore = fileDigest(marker) === fresh.marker_sha256;
  invariant(markerBefore || (journal.removed.length === removals.length && fs.readFileSync(marker, "utf8") === after), "SKILL_MARKER_CHANGED", "Ownership marker changed during cleanup");
  // Preflight every remaining removal before continuing an interrupted pass.
  const verifyEntry = (entry: typeof removals[number]) => {
    invariant(entry.path === path.join(fresh.directory, entry.name), "SKILL_PLAN_CHANGED", "Removal path differs from its installed name");
    const stat = fs.lstatSync(entry.path, { throwIfNoEntry: false });
    if (!stat) { invariant(journal.started.includes(entry.name), "SKILL_PLAN_CHANGED", "Unstarted removal disappeared"); return; }
    invariant(!journal.removed.includes(entry.name), "SKILL_PLAN_CHANGED", "An already removed entry was recreated");
    if ("link" in entry) {
      invariant(digest(identity(entry.path)) === digest(entry.identity) && stat.isSymbolicLink() && fs.readlinkSync(entry.path) === entry.link, "SKILL_PLAN_CHANGED", "Installed link changed before removal");
      const target = path.resolve(path.dirname(entry.path), entry.link!);
      invariant(digest(fs.existsSync(target) ? inventory(target) : null) === digest(entry.target_files), "SKILL_PLAN_CHANGED", "Linked Skill content changed before removal");
    } else {
      invariant(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === entry.identity!.dev && stat.ino === entry.identity!.ino, "SKILL_PLAN_CHANGED", "Installed directory identity changed");
      const expected = entry.files!, directories = Object.keys(expected).flatMap((file) => { const parts = file.split("/"); return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/")); });
      const files = inventory(entry.path, journal.started.includes(entry.name) ? directories : []);
      invariant(journal.started.includes(entry.name) ? Object.entries(files).every(([file, sha]) => expected[file] === sha) : digest(files) === digest(expected), "SKILL_PLAN_CHANGED", "Installed copy was edited or gained files during cleanup");
    }
  }
  for (const entry of removals) verifyEntry(entry);
  for (const entry of removals) {
    if (journal.removed.includes(entry.name)) continue;
    verifyEntry(entry);
    if (!journal.started.includes(entry.name)) { journal.started.push(entry.name); save(); }
    if (fs.lstatSync(entry.path, { throwIfNoEntry: false })) {
      if ("link" in entry) fs.unlinkSync(entry.path);
      else fs.rmSync(entry.path, { recursive: true });
    }
    invariant(!fs.lstatSync(entry.path, { throwIfNoEntry: false }), "SKILL_REMOVE_INCOMPLETE", "Installed entry remains after removal");
    journal.removed.push(entry.name); save();
  }
  invariant(!markerBefore || fileDigest(marker) === fresh.marker_sha256, "SKILL_MARKER_CHANGED", "Ownership marker changed before commit");
  if (markerBefore) atomicWrite(marker, after);
  journal.after_marker_sha256 = fileDigest(marker); save();
  return { removed: removals.map((entry) => entry.path), retained: fresh.entries.filter((entry) => entry.disposition === "retain"), deduplicated: false };
}
