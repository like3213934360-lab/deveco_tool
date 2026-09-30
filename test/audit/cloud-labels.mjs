// Cloud label audit. Ground truth is NOT our heuristic: it is the section's own content checked
// against the official doc corpus (the local pack = HarmonyOS official docs snapshot):
//   official  <=> a doc in the local pack has the same title AND shares substantial text with the section
//   community <=> no local doc shares substantial text (blog/article/Q&A)
// Text overlap = fraction of the section's distinctive 12-char shingles found in the candidate doc.
// Sections that match neither rule cleanly are reported as "undetermined" (never counted as correct).
import fs from "node:fs";
import { evidence, mcp, record } from "./lib.mjs";

const queries = [
  "Push Kit 获取 Push Token tokenUpdate",
  "Navigation 路由跳转 NavPathStack pushPath",
  "@ComponentV2 @Local @Param 状态管理",
  "LazyForEach 列表性能优化",
  "PersistenceV2 AppStorageV2 数据持久化",
  "Web组件 JavaScript 交互 runJavaScript",
  "相机 Camera Kit 拍照 预览",
  "卡片 FormExtensionAbility 刷新",
];

const c = await mcp({ shared: true }); // uses the logged-in CodeGenie session
const norm = (s) => s.replace(/[#*`>|\-\[\]()\s]/g, "");
const shingles = (s, n = 12) => { const t = norm(s); const out = new Set(); for (let i = 0; i + n <= t.length; i += 6) out.add(t.slice(i, i + n)); return out; };

async function readDoc(id) {
  let text = "", offset = 0;
  for (let i = 0; i < 20; i++) {
    const r = await c.call("knowledge", { action: "read", id, offset, limit: 40000 });
    if (r.isError) return undefined;
    text += r.data.content;
    if (!r.data.next) break;
    offset = r.data.next.offset;
  }
  return text;
}

const rows = [];
for (const q of queries) {
  const r = await c.call("knowledge", { action: "search", source: "cloud", query: q });
  if (r.isError) { record(`B.knowledge.cloud.query.${q}`, "UNVERIFIED", `cloud search failed: ${r.data.error?.code}`); continue; }
  // full text of every section from the artifact
  let full = "", line = 0;
  for (;;) { const p = (await c.call("job", { action: "read", artifact_id: r.data.full_artifact, line, limit: 2000 })).data; full += p.content + "\n"; if (p.next_line == null) break; line = p.next_line; }
  const sections = full.split(/(?=^\[\d+\]【)/m).filter((s) => /^\[\d+\]【/.test(s));
  for (const s of r.data.sources) {
    const sec = sections.find((x) => x.startsWith(`[${s.n}]【`)) ?? "";
    const body = sec.slice(sec.indexOf("网页内容：") + 5);
    const sh = shingles(body);
    // candidates: our local_doc, plus top local doc-search hits for the title
    const cands = new Set(s.local_doc ? [s.local_doc] : []);
    const hits = (await c.call("knowledge", { action: "search", query: s.title, kind: "docs", limit: 5 })).data?.results ?? [];
    for (const h of hits) cands.add(h.id);
    let best = { id: null, overlap: 0, title: "" };
    for (const id of cands) {
      const doc = await readDoc(id);
      if (!doc) continue;
      const d = norm(doc);
      let hit = 0; for (const x of sh) if (d.includes(x)) hit++;
      const overlap = sh.size ? hit / sh.size : 0;
      if (overlap > best.overlap) best = { id, overlap, title: hits.find((h) => h.id === id)?.title ?? id };
    }
    const truth = sh.size < 5 ? "undetermined" : best.overlap >= 0.5 ? "official" : best.overlap <= 0.1 ? "community" : "undetermined";
    rows.push({ query: q, n: s.n, title: s.title, label: s.origin === "official_other_platform" ? "official" : s.origin, truth, overlap: +best.overlap.toFixed(2), best_doc: best.id, label_local_doc: s.local_doc ?? null, shingles: sh.size });
  }
  console.log(q, "sections", r.data.sources.length);
}
await c.close();

const decided = rows.filter((r) => r.truth !== "undetermined");
const wrong = decided.filter((r) => r.truth !== r.label);
const wrongDoc = rows.filter((r) => r.label === "official" && r.truth === "official" && r.label_local_doc && r.best_doc && r.label_local_doc !== r.best_doc);
const stats = {
  sections: rows.length, decided: decided.length, undetermined: rows.length - decided.length,
  correct: decided.length - wrong.length, wrong: wrong.length,
  accuracy: decided.length ? +((decided.length - wrong.length) / decided.length).toFixed(3) : null,
  official_as_community: wrong.filter((r) => r.truth === "official").length,
  community_as_official: wrong.filter((r) => r.truth === "community").length,
  wrong_local_doc: wrongDoc.length,
};
const ev = evidence("cloud-labels", "sections.json", { stats, rows });
record("B.knowledge.cloud.labels", wrong.length || wrongDoc.length ? "DEFECT" : "VERIFIED",
  `${stats.sections} sections / ${queries.length} queries: accuracy ${stats.accuracy} on ${stats.decided} decidable (${stats.official_as_community} official labelled community, ${stats.community_as_official} community labelled official), ${stats.undetermined} undetermined, ${stats.wrong_local_doc} official with wrong local_doc`, [ev], { stats });
console.log(JSON.stringify(stats));
for (const w of wrong.slice(0, 40)) console.log("  WRONG", w.label, "truth", w.truth, w.overlap, w.title, "->", w.best_doc);
for (const w of wrongDoc.slice(0, 20)) console.log("  DOC  ", w.title, "label:", w.label_local_doc, "best:", w.best_doc);
