// Exhaustive capability extraction from upstream sources (no hand-picked lists).
//
// Item IDs (smallest granularity):
//   code:tool:<name>                       deveco-code tool (Tool.define / define)
//   code:tool:<name>:param:<p>             its Schema.Struct parameters
//   code:tool:<name>:enum:<p>=<v>          Schema.Literals values (incl. referenced const arrays)
//   cli:cmd:<path>                         deveco-cli command (commander tree, addCommand resolved)
//   cli:cmd:<path>:opt:<--flag>            .option / .requiredOption / new Option
//   cli:cmd:<path>:arg:<name>              .argument / new Argument / "<name>" in .command('x <name>')
//   cli:cmd:<path>:choice:<--flag|arg>=<v> .choices([...])
//   climcp:tool:<name>[:param:<p>|:enum:<p>=<v>]   deveco-cli bundled MCP server (toolRouter.add + zod)
//   code:skill:<name> / code:command:<name> / code:spec:<file> / code:agent:<name>
//
// Usage: node tools/upstream/extract.mjs --code <deveco-code> --cli <deveco-cli> [--json]
import fs from "node:fs";
import path from "node:path";

/* ------------------------------- helpers ------------------------------- */

const read = (f) => fs.readFileSync(f, "utf8");
const walk = (dir, filter) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "test") out.push(...walk(p, filter)); }
    else if (filter(p)) out.push(p);
  }
  return out;
};
const isSrc = (p) => p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts");

/** Index of the bracket that closes the one at `open` (skips strings/template literals/comments). */
export function matchBracket(text, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2) + 1; continue; }
    if (c === "'" || c === '"' || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") { if (stack.pop() !== c) return -1; if (!stack.length) return i; }
  }
  return -1;
}
const strings = (s) => [...s.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
/** Resolve `const NAME = [ 'a', 'b' ] as const` in the same file. */
const constArray = (text, name) => {
  const m = new RegExp(`(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*\\[`).exec(text);
  if (!m) return [];
  const start = m.index + m[0].length - 1;
  return strings(text.slice(start, matchBracket(text, start) + 1));
};

/* ------------------------------ deveco-code ------------------------------ */

/** Resolve a tool id argument: string literal, local const, or `X.ToolID` from an imported module. */
function toolId(arg, text, file) {
  const lit = /^["']([\w-]+)["']$/.exec(arg);
  if (lit) return lit[1];
  const local = new RegExp(`const\\s+${arg}\\s*=\\s*["']([\\w-]+)["']`).exec(text);
  if (local) return local[1];
  const member = /^(\w+)\.(\w+)$/.exec(arg);
  if (member) {
    const imp = new RegExp(`import\\s+\\*\\s+as\\s+${member[1]}\\s+from\\s+["'](\\.[^"']+)["']`).exec(text)
      ?? new RegExp(`import\\s+\\{[^}]*\\b${member[1]}\\b[^}]*\\}\\s+from\\s+["'](\\.[^"']+)["']`).exec(text);
    const base = imp && path.resolve(path.dirname(file), imp[1]);
    for (const cand of base ? [`${base}.ts`, path.join(base, "index.ts"), base.replace(/\.js$/, ".ts")] : []) {
      if (fs.existsSync(cand)) {
        const v = new RegExp(`export\\s+const\\s+${member[2]}\\s*=\\s*["']([\\w-]+)["']`).exec(read(cand));
        if (v) return v[1];
      }
    }
  }
  return undefined;
}

function codeTools(root) {
  const items = [];
  const toolDir = path.join(root, "packages/opencode/src/tool");
  for (const file of walk(toolDir, isSrc)) {
    const text = read(file);
    for (const m of text.matchAll(/(?:Tool\.define|=\s*define)(?:<[\s\S]*?>)?\(\s*([\w.]+|["'][\w-]+["'])\s*,/g)) {
      const name = toolId(m[1], text, file);
      if (!name) continue;
      items.push(`code:tool:${name}`);
      // Parameters: the Schema.Struct passed as `parameters:` in the block following define(...)
      const open = text.indexOf("(", m.index);
      const block = text.slice(m.index, matchBracket(text, open) + 1);
      const paramVar = /parameters:\s*(\w+)/.exec(block)?.[1];
      if (!paramVar) continue;
      const decl = new RegExp(`(?:const|let)\\s+${paramVar}\\s*=\\s*Schema\\.Struct\\(`).exec(text);
      if (!decl) continue;
      const sOpen = decl.index + decl[0].length - 1;
      const struct = text.slice(sOpen + 1, matchBracket(text, sOpen));
      // top-level keys: "key: Schema..." at depth 1
      let depth = 0;
      for (let i = 0; i < struct.length; i++) {
        const c = struct[i];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (depth === 1 || (depth === 0 && /[\s{,]/.test(struct[i - 1] ?? " "))) {
          const km = /^([A-Za-z_]\w*):\s*Schema\./.exec(struct.slice(i));
          if (km && depth <= 1) {
            items.push(`code:tool:${name}:param:${km[1]}`);
            // Only this key's own schema expression (up to the next top-level key).
            const rest = struct.slice(i + km[1].length + 1);
            const nextKey = /,\s*\n\s*[A-Za-z_]\w*:\s*Schema\./.exec(rest);
            const tail = nextKey ? rest.slice(0, nextKey.index) : rest;
            const lit = /Schema\.Literals?\(\s*(\[[^\]]*\]|[A-Za-z_]\w*)/.exec(tail);
            if (lit) {
              const values = lit[1].startsWith("[") ? strings(lit[1]) : constArray(text, lit[1]);
              for (const v of values) items.push(`code:tool:${name}:enum:${km[1]}=${v}`);
            }
            i += km[0].length - 1;
          }
        }
      }
    }
  }
  return items;
}

function codeContent(root) {
  const items = [];
  const res = path.join(root, "packages/opencode/resources");
  const skills = path.join(res, "skills");
  for (const d of fs.existsSync(skills) ? fs.readdirSync(skills) : [])
    if (fs.existsSync(path.join(skills, d, "SKILL.md"))) items.push(`code:skill:${d}`);
  for (const sub of ["commands", "templates"])
    for (const f of fs.existsSync(path.join(res, "spec", sub)) ? fs.readdirSync(path.join(res, "spec", sub)) : [])
      items.push(`code:spec:${sub}/${f}`);
  const cmdDir = path.join(root, "packages/opencode/src/command/template");
  for (const f of fs.existsSync(cmdDir) ? fs.readdirSync(cmdDir) : []) items.push(`code:command:${f.replace(/\.txt$/, "")}`);
  const agent = path.join(root, "packages/opencode/src/agent/agent.ts");
  if (fs.existsSync(agent)) {
    const text = read(agent);
    for (const m of text.matchAll(/^\s{10}"?([a-z][\w-]*)"?:\s*\{\s*$/gm)) items.push(`code:agent:${m[1]}`);
  }
  return items;
}

/* ------------------------------- deveco-cli ------------------------------- */

/**
 * Parse commander definitions. Each variable bound to a Command gets a node; chains of
 * `.command('x')` create children; `.addCommand(v)` / `.addCommand(new Command(...)...)` attach.
 */
export function cliCommands(cmdFiles, entryFile) {
  const nodes = new Map(); // id -> { name, opts:Set, args:Set, choices:Set, children:[] }
  const vars = new Map(); // `${file}:${var}` or exported name -> node id
  const exportsByFile = new Map();
  let seq = 0;
  const node = (name) => { const id = seq++; nodes.set(id, { name, opts: new Set(), args: new Set(), choices: new Set(), children: [] }); return id; };

  // Scan a command chain text: options / args / choices / subcommands (.command) / inline addCommand
  const scanChain = (file, text, id) => {
    const n = nodes.get(id);
    let pos = 0;
    // stop at the first .command( — it starts a child chain; process sequentially
    const re = /\.(option|requiredOption|argument|arguments|addOption|addArgument|command|addCommand|choices)\(/g;
    let current = id;
    let lastFlag = null;
    for (let m; (m = re.exec(text)); ) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(text, open);
      if (close < 0) break;
      const inner = text.slice(open + 1, close);
      const kind = m[1];
      const cur = nodes.get(current);
      if (kind === "command") {
        const spec = strings(inner)[0] ?? "";
        const [name, ...args] = spec.split(/\s+/);
        const child = node(name);
        for (const a of args) nodes.get(child).args.add(a.replace(/[<>[\]]|\.\.\./g, ""));
        n.children.push(child);
        current = child;
        lastFlag = null;
      } else if (kind === "option" || kind === "requiredOption") {
        const flag = /['"`]([^'"`]+)['"`]/.exec(inner)?.[1];
        if (flag && flag.startsWith("-")) { const long = flag.match(/--[\w-]+/)?.[0] ?? flag.split(/[ ,]/)[0]; cur.opts.add(long); lastFlag = long; }
        else if (/^\.\.\.\w+/.test(inner.trim())) { // spread constant: .option(...DEVICE_FLAG)
          const c = new RegExp(`${inner.trim().slice(3)}\\s*=\\s*\\[\\s*['"]([^'"]+)`).exec(read(file))?.[1];
          if (c) { const long = c.match(/--[\w-]+/)?.[0]; if (long) { cur.opts.add(long); lastFlag = long; } }
        }
      } else if (kind === "addOption") {
        const flag = /new Option\(\s*['"`]([^'"`]+)/.exec(inner)?.[1] ?? null;
        const viaFn = /^\s*(\w+)\(/.exec(inner)?.[1];
        let long = flag?.match(/--[\w-]+/g)?.pop() ?? null;
        let choiceText = inner;
        if (!flag && viaFn) { // factory: function xOption() { return new Option('--x', ...).choices([...]) }
          const src = read(file);
          const fm = new RegExp(`function\\s+${viaFn}\\s*\\([^)]*\\)[^{]*\\{`).exec(src);
          if (fm) {
            const body = src.slice(fm.index, matchBracket(src, fm.index + fm[0].length - 1) + 1);
            long = /new Option\(\s*['"`]([^'"`]+)/.exec(body)?.[1]?.match(/--[\w-]+/g)?.pop() ?? null;
            choiceText = body;
          }
        }
        if (long) {
          cur.opts.add(long);
          const cm = /\.choices\(\s*(\[[^\]]*\]|[A-Za-z_]\w*)/.exec(choiceText);
          if (cm) for (const v of cm[1].startsWith("[") ? strings(cm[1]) : constArray(read(file), cm[1])) cur.choices.add(`${long}=${v}`);
        }
      } else if (kind === "argument" || kind === "arguments") {
        for (const a of (strings(inner)[0] ?? "").split(/\s+/).filter(Boolean)) cur.args.add(a.replace(/[<>[\]]|\.\.\./g, ""));
      } else if (kind === "addArgument") {
        const a = /new Argument\(\s*['"`]([^'"`]+)/.exec(inner)?.[1];
        if (a) {
          const argName = a.replace(/[<>[\]]|\.\.\./g, "");
          cur.args.add(argName);
          const cm = /\.choices\(\s*(\[[^\]]*\])/.exec(inner);
          if (cm) for (const v of strings(cm[1])) cur.choices.add(`${argName}=${v}`);
        }
      } else if (kind === "choices" && lastFlag) {
        for (const v of strings(inner)) cur.choices.add(`${lastFlag}=${v}`);
      } else if (kind === "addCommand") {
        const t = inner.trim();
        const ref = /^(\w+)(\(\))?$/.exec(t);
        if (ref) cur.children.push({ ref: ref[1], file });
        else if (t.startsWith("new Command")) {
          const name = strings(t)[0];
          const child = node(name);
          cur.children.push(child);
          scanChain(file, t.slice(t.indexOf(")") + 1), child);
        }
      }
      re.lastIndex = kind === "addCommand" || kind === "addOption" || kind === "addArgument" || kind === "option" || kind === "requiredOption" ? close : re.lastIndex;
    }
  };

  for (const file of cmdFiles) {
    const text = read(file);
    // Root variables: const x = new Command('name')  |  export const x = new Command('name')
    for (const m of text.matchAll(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*new Command\(\s*['"`]([\w-]+)['"`]\s*\)/g)) {
      const id = node(m[2]);
      vars.set(`${file}:${m[1]}`, id);
      // chain directly following the declaration until the statement ends
      const stmtEnd = statementEnd(text, m.index + m[0].length);
      scanChain(file, text.slice(m.index + m[0].length, stmtEnd), id);
    }
    // Factories: function createXCommand() { ... new Command('x') ... return cmd }
    for (const m of text.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*(?::\s*Command\s*)?\{/g)) {
      const bodyOpen = m.index + m[0].length - 1;
      const body = text.slice(bodyOpen, matchBracket(text, bodyOpen) + 1);
      const cm = /new Command\(\s*['"`]([\w-]+)['"`]\s*\)/.exec(body);
      if (!cm || vars.has(`${file}:${m[1]}`)) continue;
      const id = node(cm[1]);
      vars.set(`${file}:${m[1]}`, id);
      scanChain(file, body.slice(cm.index + cm[0].length), id);
    }
    // Statements continuing a variable (in source order, so aliases resolve):
    //   `x\n  .command('y')...;`   or   `const y = x\n  .command('z')...;` (y aliases the new child)
    for (const m of text.matchAll(/^(?:(?:const|let)\s+(\w+)\s*=\s*)?(\w+)\s*\n?\s*\.(\w+)\(/gm)) {
      const id = vars.get(`${file}:${m[2]}`);
      if (id === undefined) continue;
      const start = m.index + m[0].length - m[3].length - 2;
      const before = nodes.get(id).children.length;
      scanChain(file, text.slice(start, statementEnd(text, start)), id);
      if (m[1] && m[3] === "command") {
        const child = nodes.get(id).children[before];
        if (typeof child === "number") vars.set(`${file}:${m[1]}`, child);
      }
    }
    const def = /export\s+default\s+(\w+)/.exec(text)?.[1];
    exportsByFile.set(file, { def, named: [...text.matchAll(/export\s+(?:const|function)\s+(\w+)/g)].map((x) => x[1]) });
  }

  // Resolve addCommand references across files (imports by name).
  const resolveRef = (ref, fromFile) => {
    const local = vars.get(`${fromFile}:${ref}`);
    if (local !== undefined) return local;
    for (const [file, ex] of exportsByFile) {
      if (ex.named.includes(ref) && vars.has(`${file}:${ref}`)) return vars.get(`${file}:${ref}`);
    }
    // default import: `import x from './file.js'`
    const imp = new RegExp(`import\\s+${ref}\\s+from\\s+['"]\\./([\\w-]+)\\.js['"]`).exec(read(fromFile));
    if (imp) {
      const target = cmdFiles.find((f) => path.basename(f, ".ts") === imp[1]);
      const def = target && exportsByFile.get(target)?.def;
      if (def) return vars.get(`${target}:${def}`);
    }
    // any file defining this exported factory/variable
    for (const [key, id] of vars) if (key.endsWith(`:${ref}`)) return id;
    return undefined;
  };
  for (const n of nodes.values())
    n.children = n.children.map((c) => (typeof c === "number" ? c : resolveRef(c.ref, c.file))).filter((c) => c !== undefined);

  // Roots: commands added to the program in the entry file.
  const entry = read(entryFile);
  const roots = [...entry.matchAll(/program\.addCommand\((\w+)\)/g)].map((m) => {
    const imp = new RegExp(`import\\s+${m[1]}\\s+from\\s+['"]\\./commands/([\\w-]+)\\.js['"]`).exec(entry);
    const file = imp && cmdFiles.find((f) => path.basename(f, ".ts") === imp[1]);
    const def = file && exportsByFile.get(file)?.def;
    return def !== undefined ? vars.get(`${file}:${def}`) : undefined;
  }).filter((x) => x !== undefined);

  const items = [];
  const visit = (id, prefix, seen) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = nodes.get(id);
    const p = prefix ? `${prefix} ${n.name}` : n.name;
    items.push(`cli:cmd:${p}`);
    for (const o of n.opts) if (!["--help", "--version"].includes(o)) items.push(`cli:cmd:${p}:opt:${o}`);
    for (const a of n.args) items.push(`cli:cmd:${p}:arg:${a}`);
    for (const c of n.choices) items.push(`cli:cmd:${p}:choice:${c}`);
    for (const c of n.children) visit(c, p, new Set(seen));
  };
  for (const r of roots) visit(r, "", new Set());
  return items;
}

/** End of the statement starting at `from`: the first `;` at depth 0, or a blank line / new top-level statement. */
function statementEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === "`") { for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++; continue; }
    if (c === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return text.length; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ";" && depth === 0) return i;
    else if (c === "\n" && depth === 0 && /^\n\s*\n|^\n(?:const|let|export|function|async|\w+\s*\.)/.test(text.slice(i, i + 40)) && !/^\n\s*\./.test(text.slice(i, i + 40))) return i;
  }
  return text.length;
}

/* ------------------------- deveco-cli bundled MCP ------------------------- */

function cliMcp(root) {
  const items = [];
  const dir = path.join(root, "packages/cli/mcp/src-server");
  for (const file of walk(dir, isSrc)) {
    const text = read(file);
    // toolRouter.add({ name: 'x', ..., inputSchema: z.object({...}) }, handler)
    for (const m of text.matchAll(/\.add\(\s*\{\s*name:\s*['"`]([A-Za-z_]+)['"`]/g)) {
      const open = text.indexOf("{", m.index);
      const def = text.slice(open, matchBracket(text, open) + 1);
      items.push(`climcp:tool:${m[1]}`, ...zodParams(def, `climcp:tool:${m[1]}`));
    }
    // Array-driven registration: `for (const { name } of this.getX()) toolRouter.add({ name, ..., inputSchema: <var> })`
    // — tool names come from the returned array literal, parameters from the shared schema variable.
    for (const loop of text.matchAll(/for\s*\(\s*const\s*\{\s*name\b[^}]*\}\s*of\s*this\.(\w+)\(\)\s*\)\s*\{[\s\S]{0,300}?inputSchema:\s*(\w+)/g)) {
      // the method definition (not a call site): `private getX(): Type {` / `getX() {`
      const fn = new RegExp(`^\\s*(?:(?:private|public|protected|static|async)\\s+)*${loop[1]}\\(\\)`, "m").exec(text);
      if (!fn) continue;
      // Skip a return-type annotation (which may contain `{...}` / `<...>`) to the body's `{` at line end.
      const bodyOpen = text.slice(fn.index).search(/\{\s*\n/) + fn.index;
      const body = text.slice(bodyOpen, matchBracket(text, bodyOpen) + 1);
      const schemaDecl = new RegExp(`const\\s+${loop[2]}\\s*=\\s*z\\.object\\(`).exec(text);
      const params = schemaDecl ? zodParams(`inputSchema: ${text.slice(schemaDecl.index + schemaDecl[0].length - 9, matchBracket(text, schemaDecl.index + schemaDecl[0].length - 1) + 1)}`, "") : [];
      for (const f of body.matchAll(/name:\s*['"`]([A-Za-z_]+)['"`]/g)) {
        items.push(`climcp:tool:${f[1]}`, ...params.map((p) => `climcp:tool:${f[1]}${p}`));
      }
    }
    // standalone tool definitions: { name: 'check_cpp_files', ..., inputSchema: z.object(...) }
    for (const m of text.matchAll(/^\s*name:\s*['"`]([a-z_]+)['"`],\s*\n\s*description:/gm)) {
      if (items.includes(`climcp:tool:${m[1]}`)) continue;
      const open = text.lastIndexOf("{", m.index);
      const def = text.slice(open, matchBracket(text, open) + 1);
      if (!/inputSchema/.test(def)) continue;
      items.push(`climcp:tool:${m[1]}`, ...zodParams(def, `climcp:tool:${m[1]}`));
    }
  }
  return items;
}
function zodParams(def, prefix) {
  const out = [];
  const zo = /inputSchema:\s*z\.object\(\s*\{/.exec(def);
  if (!zo) return out;
  const open = zo.index + zo[0].length - 1;
  const body = def.slice(open + 1, matchBracket(def, open));
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0) {
      const km = /^(\w+):\s*z\s*\.?/.exec(body.slice(i));
      if (km && /[\s,{]/.test(body[i - 1] ?? " ")) {
        out.push(`${prefix}:param:${km[1]}`);
        const rest = body.slice(i + km[1].length + 1);
        const nextKey = /,\s*\n\s*\w+:\s*z\s*\.?/.exec(rest);
        const tail = nextKey ? rest.slice(0, nextKey.index) : rest;
        const en = /z\s*\.enum\(\s*(\[[^\]]*\])/.exec(tail);
        if (en) for (const v of strings(en[1])) out.push(`${prefix}:enum:${km[1]}=${v}`);
        i += km[0].length - 1;
      }
    }
  }
  return out;
}

/* --------------------------------- main --------------------------------- */

export function extract({ code, cli }) {
  // Every source file that defines a commander Command (commands/, arktscheck/, codelinter/, ...).
  const cmdFiles = walk(path.join(cli, "packages/cli/src"), (p) => isSrc(p) && /new Command\(/.test(read(p)));
  const items = [
    ...codeTools(code),
    ...codeContent(code),
    ...cliCommands(cmdFiles, path.join(cli, "packages/cli/src/cli.ts")),
    ...cliMcp(cli),
  ];
  return [...new Set(items)].sort();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("extract.mjs")) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const code = arg("--code"), cli = arg("--cli");
  if (!code || !cli) { console.error("usage: extract.mjs --code <deveco-code> --cli <deveco-cli> [--json]"); process.exit(2); }
  const items = extract({ code, cli });
  if (process.argv.includes("--json")) console.log(JSON.stringify(items, null, 1));
  else { for (const i of items) console.log(i); console.error(`${items.length} items`); }
}
