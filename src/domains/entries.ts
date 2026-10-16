import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { z } from "zod";
import { invariant } from "../core/errors.js";
import { readJson5, walk } from "../core/files.js";
import { inspectProject } from "./project.js";

/** Index properties by their JSON path, not by names shared with metadata or other entries.
 * JSON5 already validates the document; this token walk only retains source locations. */
function declarationLines(text: string) {
  const lines = new Map<string, number>();
  const tokens: { text: string; line: number }[] = [];
  let end = 0, line = 1;
  for (const match of text.matchAll(/\/\/[^\r\n\u2028\u2029]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[{}\[\]:,]|[^\s{}\[\]:,"'/]+/g)) {
    line += text.slice(end, match.index).split(/\r\n|[\r\n\u2028\u2029]/).length - 1;
    const token = match[0];
    if (!token.startsWith("//") && !token.startsWith("/*")) tokens.push({ text: token, line });
    line += token.split(/\r\n|[\r\n\u2028\u2029]/).length - 1;
    end = match.index + token.length;
  }
  let cursor = 0;
  const visit = (at: (string | number)[]) => {
    const token = tokens[cursor++]?.text;
    if (token !== "{" && token !== "[") return;
    const close = token === "{" ? "}" : "]";
    let index = 0;
    while (cursor < tokens.length && tokens[cursor]!.text !== close) {
      let key: string | number = index++;
      if (token === "{") {
        const property = tokens[cursor++]!;
        // Parsing a one-property object also decodes quoted and escaped JSON5 keys.
        key = Object.keys(JSON5.parse(`{${property.text}:0}`))[0]!;
        if (key === "name" || key === "shortcutId") lines.set(JSON.stringify([...at, key]), property.line);
        cursor++; // colon
      }
      visit([...at, key]);
      if (tokens[cursor]?.text === ",") cursor++;
    }
    cursor++; // closing brace/bracket
  };
  visit([]);
  return lines;
}

const ability = z.object({ name: z.string().min(1), type: z.string().optional(), srcEntry: z.string().optional(), exported: z.boolean().optional(), skills: z.array(z.unknown()).optional(), metadata: z.array(z.unknown()).optional() }).passthrough();
const manifestSchema = z.object({ module: z.object({ name: z.string().optional(), mainElement: z.string().optional(), abilities: z.array(ability).optional(), extensionAbilities: z.array(ability).optional() }).passthrough() });
const profileSchema = z.object({
  forms: z.array(z.object({ name: z.string().optional(), src: z.string().optional(), supportDimensions: z.array(z.string()).optional(), defaultDimension: z.string().optional(), formConfigAbility: z.string().optional() }).passthrough()).optional(),
  shortcuts: z.array(z.object({ shortcutId: z.string().optional() }).passthrough()).optional(),
});
function configuration<T>(file: string, schema: z.ZodType<T>) {
  const result = schema.safeParse(readJson5(file));
  invariant(result.success, "PROJECT_INVALID", `Invalid entry configuration in ${file}`,
    { file, issues: result.error?.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
    "Fix the listed configuration fields, then call project action=entries again");
  return result.data;
}

/** Configuration evidence; neither a main entry nor a launch handle proves runtime success. */
export function entryGraph(root: string, product?: string) {
  const project = inspectProject(root, product), entries: Record<string, unknown>[] = [], issues: Record<string, unknown>[] = [];
  const locations = new Map<string, Map<string, number>>();
  const source = (file: string, at: (string | number)[]) => {
    if (!locations.has(file)) locations.set(file, declarationLines(fs.readFileSync(file, "utf8")));
    const line = locations.get(file)!.get(JSON.stringify(at)) ?? null;
    return { file: path.relative(project.root, file), line, precision: line === null ? "unresolved" : "declaration-candidate" };
  };
  for (const mod of project.modules) {
    const file = path.join(mod.root, "src/main/module.json5");
    if (!fs.existsSync(file)) continue;
    const manifest = configuration(file, manifestSchema).module;
    for (const [kind, key] of [["ability", "abilities"], ["extension", "extensionAbilities"]] as const) {
      for (const [index, item] of (manifest[key] ?? []).entries()) {
        entries.push({ kind, module: mod.name, module_name: manifest.name ?? mod.name, device_types: mod.deviceTypes, name: item.name, main: manifest.mainElement === item.name,
          type: item.type, src_entry: item.srcEntry, exported: item.exported ?? false, skills: item.skills ?? [], metadata: item.metadata ?? [], runtime_verified: false,
          external_launch: kind !== "ability" ? "not-ui-ability" : item.exported !== true ? "restricted" : "unverified",
          ...(item.exported !== true && kind === "ability" ? { launch_hint: "The declaration is private (exported defaults to false); shell/UIAbility launch may be rejected by visibility checks. Use an authorized in-app entry path" } : {}),
          launch: kind === "ability" && item.exported === true ? { tool: "run", action: "launch", project: project.root, product: project.product, module: mod.name, ability: item.name } : null,
          source: source(file, ["module", key, index, "name"]) });
      }
    }
    const resources = path.join(mod.root, "src/main/resources");
    const profiles = [...walk(resources)].filter((entry) => /^[^./\\][^/\\]*[\\/]profile[\\/][^/\\]+\.json$/.test(path.relative(resources, entry)));
    const references = new Map<string, { kind: "form" | "shortcut"; owner: string; resource: string }[]>();
    for (const [owners, expected] of [[manifest.extensionAbilities ?? [], "form"], [manifest.abilities ?? [], "shortcut"]] as const) for (const owner of owners) {
      for (const metadata of owner.metadata ?? []) {
        const value = metadata as { name?: string; resource?: string } | null;
        const kind = value?.name === "ohos.extension.form" ? "form" : value?.name === "ohos.ability.shortcuts" ? "shortcut" : undefined;
        if (kind !== expected || !value) continue;
        const name = /^\$profile:([\w-]+)$/.exec(value.resource ?? "")?.[1];
        const matches = name ? profiles.filter((entry) => path.basename(entry) === `${name}.json`) : [];
        if (!matches.length) issues.push({ module: mod.name, owner: owner.name, resource: value.resource ?? null, problems: [`${kind} profile reference is invalid or missing`] });
        for (const entry of matches) references.set(entry, [...(references.get(entry) ?? []), { kind, owner: owner.name, resource: value.resource! }]);
      }
    }
    for (const [entry, owners] of references) {
      // Unreferenced resource profiles are not declarations and are not parsed.
      const data = configuration(entry, profileSchema);
      if (owners.some((o) => o.kind === "form") && !data.forms) issues.push({ module: mod.name, profile: path.relative(project.root, entry), problems: ["referenced form profile has no forms array"] });
      for (const [index, form] of (owners.some((o) => o.kind === "form") ? data.forms ?? [] : []).entries()) {
        const problem = [];
        if (!form.name || !form.src || !Array.isArray(form.supportDimensions) || !form.supportDimensions.length) problem.push("name/src/supportDimensions missing");
        if (!form.defaultDimension || !form.supportDimensions?.includes(form.defaultDimension)) problem.push("defaultDimension is not supported");
        const configName = form.formConfigAbility?.replace(/^ability:\/\//, "");
        const configResolved = configName ? (manifest.abilities ?? []).some((a) => a.name === configName) : undefined;
        if (problem.length) issues.push({ module: mod.name, form: form.name, problems: problem });
        entries.push({ ...form, kind: "form", module: mod.name, module_name: manifest.name ?? mod.name, device_types: mod.deviceTypes,
          referenced_by: owners.filter((o) => o.kind === "form"), resource_qualifier: path.relative(resources, entry).split(path.sep)[0],
          config_ability_resolution: configName ? { status: configResolved ? "declared-in-module" : "unresolved", scope: "declaring-module", value: form.formConfigAbility } : undefined,
          source: source(entry, ["forms", index, "name"]), validation: problem.length ? "failed" : "passed", runtime_verified: false });
      }
      for (const [index, shortcut] of (owners.some((o) => o.kind === "shortcut") ? data.shortcuts ?? [] : []).entries()) entries.push({ ...shortcut, kind: "shortcut", module: mod.name, module_name: manifest.name ?? mod.name, referenced_by: owners.filter((o) => o.kind === "shortcut"), device_types: mod.deviceTypes, runtime_verified: false, source: source(entry, ["shortcuts", index, "shortcutId"]) });
    }
  }
  return { bundle: project.bundleName, product: project.product, entries, issues, scope: "declared-configuration",
    runtime: "All entries and launch handles are declarations, not installation or launch receipts. main identifies module.mainElement; device_types lists declared compatibility. Verify the selected device/module at runtime. Form profile variants are candidates, not device-selected resources. Configuration abilities unresolved within their module require SDK/runtime verification; host attachment and lifecycle require device evidence" };
}
