import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { readJson5, walk } from "../core/files.js";
import { inspectProject } from "./project.js";

/** Locate declaration properties, ignoring comments and strings that merely mention an entry. */
function declarationLines(text: string) {
  const lines = new Map<string, number>();
  let property = "", propertyAt = 0, colon = false;
  for (const match of text.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[\w$]+|[^\s]/g)) {
    const token = match[0];
    if (token.startsWith("//") || token.startsWith("/*")) continue;
    const quoted = token.startsWith('"') || token.startsWith("'");
    const value = quoted ? JSON5.parse(token) as string : token;
    if (colon && quoted && (property === "name" || property === "shortcutId")) {
      const key = JSON.stringify([property, value]);
      if (!lines.has(key)) lines.set(key, text.slice(0, propertyAt).split(/\r\n|\r|\n/).length);
    }
    colon = token === ":";
    if (!colon) { property = value; propertyAt = match.index; }
  }
  return lines;
}

/** Configuration evidence; neither a main entry nor a launch handle proves runtime success. */
export function entryGraph(root: string, product?: string) {
  const project = inspectProject(root, product), entries: Record<string, unknown>[] = [], issues: Record<string, unknown>[] = [];
  const locations = new Map<string, Map<string, number>>();
  const source = (file: string, name: string, key = "name") => {
    if (!locations.has(file)) locations.set(file, declarationLines(fs.readFileSync(file, "utf8")));
    const line = locations.get(file)!.get(JSON.stringify([key, name])) ?? null;
    return { file: path.relative(project.root, file), line, precision: line === null ? "unresolved" : "declaration-candidate" };
  };
  for (const mod of project.modules) {
    const file = path.join(mod.root, "src/main/module.json5");
    if (!fs.existsSync(file)) continue;
    const manifest = readJson5(file).module as any;
    for (const [kind, list] of [["ability", manifest.abilities ?? []], ["extension", manifest.extensionAbilities ?? []]] as const) {
      for (const item of list) {
        entries.push({ kind, module: mod.name, device_types: mod.deviceTypes, name: item.name, main: manifest.mainElement === item.name,
          type: item.type, src_entry: item.srcEntry, exported: item.exported, skills: item.skills ?? [], metadata: item.metadata ?? [], runtime_verified: false,
          launch: kind === "ability" ? { tool: "run", action: "launch", project: project.root, product: project.product, module: mod.name, ability: item.name } : null,
          source: source(file, item.name) });
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
        entries.push({ ...form, kind: "form", module: mod.name, device_types: mod.deviceTypes, source: source(entry, form.name ?? ""), validation: problem.length ? "failed" : "passed", runtime_verified: false });
      }
      if (Array.isArray(data.shortcuts)) for (const shortcut of data.shortcuts) entries.push({ ...shortcut, kind: "shortcut", module: mod.name, device_types: mod.deviceTypes, runtime_verified: false, source: source(entry, shortcut.shortcutId ?? "", "shortcutId") });
    }
  }
  return { bundle: project.bundleName, product: project.product, entries, issues, scope: "declared-configuration",
    runtime: "All entries and launch handles are declarations, not installation or launch receipts. main identifies module.mainElement; device_types lists declared compatibility. Verify the selected device/module at runtime. Form configuration abilities are checked within their declaring module; host attachment, refresh and lifecycle require device evidence" };
}
