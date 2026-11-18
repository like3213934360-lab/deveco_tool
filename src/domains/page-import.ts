import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { z } from "zod";
import { saveArtifact } from "../core/artifacts.js";
import { stateDir } from "../core/config.js";
import { errorResult, invariant, ToolError } from "../core/errors.js";
import { atomicWrite, fileSnapshot, inside, sha256 } from "../core/files.js";
import { json5Locations } from "../core/json5-source.js";
import type { Project } from "./project.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const staged = z.object({ source: z.string().min(1), replace_sha256: digest.optional() });
const importPlan = z.object({
  module: z.string().min(1),
  page: staged.extend({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/), source: staged.shape.source.optional() }).strict(),
  media: z.array(staged.extend({ name: z.string().regex(/^[a-z][a-z0-9_]{0,79}\.(?:png|jpg|jpeg|webp|svg|gif)$/) }).strict()).max(32).default([]),
}).strict();

interface Change { file: string; source?: string; before?: Buffer; after: Buffer; mode?: number; text: boolean; reuse?: boolean }

function directory(file: string) {
  invariant(fs.lstatSync(file, { throwIfNoEntry: false })?.isDirectory() && fs.realpathSync(file) === file,
    "INVALID_INPUT", "Expected an existing project directory with no symbolic path", { directory: file });
}

function parse(file: string, bytes: Buffer, code: "PROJECT_INVALID" | "INVALID_INPUT") {
  try { return JSON5.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (error) { throw new ToolError(code, "Cannot read import JSON", { file, cause: errorResult(error).message }); }
}

function inspectPlan(project: Project, planPath: string) {
  const root = fs.realpathSync(project.root), file = path.resolve(root, planPath);
  const raw = fileSnapshot(file, 65536);
  invariant(raw, "INVALID_INPUT", "Page import plan does not exist", { file });
  const plan = importPlan.parse(parse(file, raw.bytes, "INVALID_INPUT")), base = path.dirname(file);
  invariant(plan.page.source || (plan.page.replace_sha256 && plan.media.length), "INVALID_INPUT", "Import a staged page or revise media for an exact existing page");
  const selected = project.modules.find((item) => item.name === plan.module);
  invariant(selected && ["entry", "feature"].includes(selected.type), "INVALID_INPUT", "Select an entry or feature module in this product", { module: plan.module });
  const main = inside(root, path.join(selected.root, "src/main"));
  directory(main);
  const manifestFile = path.join(main, "module.json5"), manifest = fileSnapshot(manifestFile, 256_000);
  invariant(manifest, "PROJECT_INVALID", "Missing module manifest", { file: manifestFile });
  const ref = /^\$profile:([\w-]+)$/.exec(parse(manifestFile, manifest.bytes, "PROJECT_INVALID")?.module?.pages ?? "")?.[1];
  invariant(ref, "PROJECT_INVALID", "The selected module needs a $profile page list", { module: plan.module });
  const profileFile = path.join(main, `resources/base/profile/${ref}.json`), profile = fileSnapshot(profileFile, 256_000);
  invariant(profile, "PROJECT_INVALID", "The module's base page list does not exist", { file: profileFile });
  const text = profile.bytes.toString("utf8"), pages: unknown = parse(profileFile, profile.bytes, "PROJECT_INVALID")?.src;
  invariant(Array.isArray(pages) && pages.every((page) => typeof page === "string"), "PROJECT_INVALID", "Page profile must declare a src array of routes", { file: profileFile });
  const route = `pages/${plan.page.name}`;
  const registered = pages.some((page) => page.toLowerCase() === route.toLowerCase());
  invariant(plan.page.replace_sha256 ? pages.includes(route) : !registered, "CONFLICT",
    plan.page.replace_sha256 ? "The page revision needs the existing registered route" : "A route with this name already exists", { route });
  const pageFile = path.join(main, `ets/${route}.ets`), mediaDir = path.join(main, "resources/base/media");
  const directories = [path.dirname(pageFile), ...(plan.media.length ? [mediaDir] : [])].filter((candidate) => {
    if (fs.lstatSync(candidate, { throwIfNoEntry: false })) { directory(candidate); return false; }
    directory(path.dirname(candidate));
    return true;
  });

  let bytes = 0;
  function stagedChange(entry: { name: string; source: string; replace_sha256?: string }, destination: string, limit: number, isPage = false): Change {
    const parent = path.dirname(destination);
    const source = inside(base, entry.source);
    invariant(path.extname(source).toLowerCase() === path.extname(destination) && source !== destination, "INVALID_INPUT", "Use a separate staged file with the matching extension", { source, destination });
    const input = fileSnapshot(source, limit), current = fileSnapshot(destination, limit);
    invariant(input?.bytes.length, "INVALID_INPUT", "Staged file is missing or empty", { source });
    if (isPage) {
      try { new TextDecoder("utf-8", { fatal: true }).decode(input.bytes); }
      catch { throw new ToolError("INVALID_INPUT", "Staged ArkUI page must be UTF-8", { source }); }
    }
    const reuse = !isPage && !entry.replace_sha256 && current?.bytes.equals(input.bytes);
    invariant(entry.replace_sha256 ? current && sha256(current.bytes) === entry.replace_sha256 : !current || reuse,
      "CONFLICT", "An existing destination requires an exact replace_sha256", { file: destination });
    bytes += input.bytes.length + (reuse ? 0 : current?.bytes.length ?? 0);
    invariant(bytes <= 24 * 1024 * 1024, "INVALID_INPUT", "Total staged and replaced bytes exceed 24 MiB");
    const stem = path.parse(destination).name.toLowerCase();
    const collision = !directories.includes(parent) && fs.readdirSync(parent).find((name) => name !== path.basename(destination) && path.parse(name).name.toLowerCase() === stem);
    invariant(!collision, "CONFLICT", "Another source or resource has this name", { file: destination, collision });
    return { file: destination, source, before: current?.bytes, after: reuse ? current!.bytes : input.bytes, mode: current?.mode, text: isPage, reuse };
  }

  invariant(new Set(plan.media.map((entry) => path.parse(entry.name).name)).size === plan.media.length, "INVALID_INPUT", "Duplicate media names in page import");
  const changes: Change[] = [];
  if (plan.page.source) changes.push(stagedChange({ ...plan.page, source: plan.page.source }, pageFile, 256_000, true));
  else {
    const page = fileSnapshot(pageFile, 256_000);
    invariant(page && sha256(page.bytes) === plan.page.replace_sha256, "CONFLICT", "The original page changed before the media revision", { file: pageFile });
  }
  for (const entry of plan.media) changes.push(stagedChange(entry, path.join(mediaDir, entry.name), 4_194_304));
  if (!registered) {
    const locations = json5Locations(text);
    const at = pages.length ? locations.get(JSON.stringify(["src", pages.length - 1]))?.end : (locations.get('["src"]')?.start ?? -1) + 1;
    invariant(at && at <= text.length, "PROJECT_INVALID", "Cannot locate the page list safely", { file: profileFile });
    const after = text.slice(0, at) + (pages.length ? ", " : "") + JSON.stringify(route) + text.slice(at);
    invariant(JSON.stringify(JSON5.parse(after).src) === JSON.stringify([...pages, route]), "PROJECT_INVALID", "Edited page list did not preserve prior routes");
    changes.push({ file: profileFile, before: profile.bytes, after: Buffer.from(after), mode: profile.mode, text: true });
  }
  const files = changes.map((entry) => ({ file: path.relative(root, entry.file), source: entry.source ?? null, ...(entry.reuse && { reuse: true }),
    before_sha256: entry.before ? sha256(entry.before) : null, after_sha256: sha256(entry.after) }));
  const review = { project: root, product: project.product, module: plan.module, route, directories: directories.map((entry) => path.relative(root, entry)), files };
  const review_sha256 = sha256(JSON.stringify({ ...review, manifest: sha256(manifest.bytes), profile: sha256(profile.bytes), page: plan.page.replace_sha256 }));
  return { changes, directories, review, review_sha256 };
}

export async function importPage(project: Project, plan: string, accepted: string | undefined, signal: AbortSignal) {
  const { changes, directories, review, review_sha256 } = inspectPlan(project, plan);
  if (accepted === undefined) {
    const details = changes.filter((item) => item.text).map((item) => `--- ${item.file} (current)\n${item.before?.toString("utf8") ?? "(new file)"}\n+++ ${item.file} (proposed)\n${item.after.toString("utf8")}`);
    const artifact = await saveArtifact([JSON.stringify(review, null, 2), ...details].join("\n\n"));
    return { ...review, review_sha256, applied: false, review_artifact: artifact.artifact_id };
  }
  invariant(accepted === review_sha256, "CONFLICT", "Staged files or project files changed since review. Generate a fresh preview");
  signal.throwIfAborted();
  const journalRoot = path.join(stateDir(), "page-import-recovery");
  fs.mkdirSync(journalRoot, { recursive: true, mode: 0o700 });
  const journal = fs.mkdtempSync(path.join(journalRoot, "import-")), written: number[] = [], created: string[] = [];
  let keep = false;
  try {
    for (const [index, item] of changes.entries()) if (item.before && !item.reuse) atomicWrite(path.join(journal, String(index)), item.before, 0o600);
    atomicWrite(path.join(journal, "review.json"), JSON.stringify({ ...review, review_sha256, restore_modes: changes.map((item) => item.mode ?? null) }), 0o600);
    for (const dir of directories) {
      directory(path.dirname(dir));
      fs.mkdirSync(dir);
      created.push(dir);
    }
    for (const [index, item] of changes.entries()) {
      signal.throwIfAborted();
      const info = review.files[index]!;
      directory(path.dirname(item.file));
      const current = fileSnapshot(item.file, 4_194_304);
      invariant((current ? sha256(current.bytes) : null) === info.before_sha256, "CONFLICT", "Destination changed during import", { file: item.file });
      if (item.reuse) continue;
      if (item.before) {
        atomicWrite(item.file, item.after, item.mode);
        written.push(index);
      } else {
        // Publish a complete new file without replacing a concurrent writer's file.
        const stage = fs.mkdtempSync(path.join(path.dirname(item.file), ".page-import-"));
        try {
          const stagedFile = path.join(stage, "new");
          atomicWrite(stagedFile, item.after);
          fs.linkSync(stagedFile, item.file);
          written.push(index);
        } finally { fs.rmSync(stage, { recursive: true, force: true }); }
      }
    }
    for (const [index, item] of changes.entries()) {
      const current = fileSnapshot(item.file, 4_194_304);
      invariant(current && sha256(current.bytes) === review.files[index]!.after_sha256, "EFFECT_UNCERTAIN", "Written file could not be verified", { file: item.file });
    }
  } catch (error) {
    const conflicts = [];
    for (const index of written.reverse()) {
      const item = changes[index]!;
      try {
        const current = fileSnapshot(item.file, 4_194_304);
        invariant(current && sha256(current.bytes) === review.files[index]!.after_sha256, "CONFLICT", "Destination changed before rollback", { file: item.file });
        if (item.before) atomicWrite(item.file, item.before, item.mode);
        else fs.unlinkSync(item.file);
      } catch (rollback) { conflicts.push(errorResult(rollback)); }
    }
    for (const dir of created.reverse()) {
      try { directory(dir); fs.rmdirSync(dir); }
      catch (rollback) { conflicts.push(errorResult(rollback)); }
    }
    if (conflicts.length) {
      keep = true;
      throw new ToolError("EFFECT_UNCERTAIN", "Page import rollback needs reconciliation", { journal, cause: errorResult(error), conflicts });
    }
    throw error;
  } finally {
    if (!keep) fs.rmSync(journal, { recursive: true, force: true });
  }
  return { ...review, review_sha256, applied: true };
}
