import fs from "node:fs";
import path from "node:path";
import { readJson5, walk } from "../core/files.js";
import { inspectProject } from "./project.js";

/** Configuration evidence, not a claim that every Extension can be launched with aa start. */
export function entryGraph(root: string, product?: string) {
  const project = inspectProject(root, product), entries: Record<string, unknown>[] = [], issues: Record<string, unknown>[] = [];
  const source = (file: string, name: string) => ({ file: path.relative(project.root, file), line: Math.max(1, fs.readFileSync(file, "utf8").split("\n").findIndex((l) => l.includes(JSON.stringify(name))) + 1), precision: "declaration-candidate" });
  for (const mod of project.modules) {
    const file = path.join(mod.root, "src/main/module.json5");
    if (!fs.existsSync(file)) continue;
    const manifest = readJson5(file).module as any;
    for (const [kind, list] of [["ability", manifest.abilities ?? []], ["extension", manifest.extensionAbilities ?? []]] as const) {
      for (const item of list) {
        entries.push({ kind, module: mod.name, name: item.name, type: item.type, src_entry: item.srcEntry, exported: item.exported, skills: item.skills ?? [], metadata: item.metadata ?? [], launch: kind === "ability" ? { tool: "run", action: "launch", project: project.root, module: mod.name, ability: item.name } : null, source: source(file, item.name) });
      }
    }
    for (const entry of walk(path.join(mod.root, "src/main/resources"))) {
      if (!/[\\/]profile[\\/][^\\/]+\.json$/.test(entry)) continue;
      // Custom raw JSON assets are not form/shortcut declarations.
      if (!/(?:["\']?forms["\']?|["\']?shortcuts["\']?)\s*:/.test(fs.readFileSync(entry, "utf8"))) continue;
      const data = readJson5(entry) as any;
      if (Array.isArray(data.forms)) for (const form of data.forms) {
        const problem = [];
        if (!form.name || !form.src || !Array.isArray(form.supportDimensions) || !form.supportDimensions.length) problem.push("name/src/supportDimensions missing");
        if (!form.supportDimensions?.includes(form.defaultDimension)) problem.push("defaultDimension is not supported");
        if (form.formConfigAbility && !(manifest.abilities ?? []).some((a: any) => a.name === String(form.formConfigAbility).replace(/^ability:\/\//, ""))) problem.push("formConfigAbility is not declared in this module");
        if (problem.length) issues.push({ module: mod.name, form: form.name, problems: problem });
        entries.push({ kind: "form", module: mod.name, ...form, source: source(entry, form.name ?? ""), validation: problem.length ? "failed" : "passed", runtime_verified: false });
      }
      if (Array.isArray(data.shortcuts)) for (const shortcut of data.shortcuts) entries.push({ kind: "shortcut", module: mod.name, ...shortcut, source: source(entry, shortcut.shortcutId ?? "") });
    }
  }
  return { bundle: project.bundleName, product: project.product, entries, issues, scope: "declared-configuration", runtime: "Host attachment, refresh and lifecycle require device evidence; extension declarations are not launch receipts" };
}
