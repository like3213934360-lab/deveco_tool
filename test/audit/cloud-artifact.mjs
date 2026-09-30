// full_artifact completeness: every section listed in sources appears exactly once in the artifact,
// and sources[].line points at that section's header line.
import { evidence, mcp, record } from "./lib.mjs";

const c = await mcp({ shared: true });
const results = [];
for (const q of ["Push Kit 获取 Push Token tokenUpdate", "LazyForEach 列表性能优化", "卡片 FormExtensionAbility 刷新"]) {
  const r = (await c.call("knowledge", { action: "search", source: "cloud", query: q })).data;
  let full = "", line = 0;
  for (;;) { const p = (await c.call("job", { action: "read", artifact_id: r.full_artifact, line, limit: 2000 })).data; full += p.content + "\n"; if (p.next_line == null) break; line = p.next_line; }
  const heads = [...full.matchAll(/^\[(\d+)\]【/gm)].map((m) => +m[1]);
  const lines = full.split("\n");
  const lineOk = r.sources.filter((s) => (lines[s.line] ?? "").startsWith(`[${s.n}]【`)).length;
  results.push({ query: q, sources: r.sources.length, headers: heads.length, unique: new Set(heads).size, lineOk, inline_chars: r.content.length });
}
await c.close();
const ok = results.every((x) => x.headers === x.sources && x.unique === x.headers && x.lineOk === x.sources);
const ev = evidence("cloud-labels", "artifact-check.json", results);
record("C.cloud-full-artifact", ok ? "VERIFIED" : "DEFECT", results.map((x) => `${x.query.slice(0, 14)}: ${x.headers}/${x.sources} sections, line ok ${x.lineOk}`).join("; "), [ev]);
