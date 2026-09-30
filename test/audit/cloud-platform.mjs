// Second cloud-label check: sections labelled "official" that are official Huawei content for ANOTHER
// platform/language (HMS Core Android/Java, Cangjie). Detection uses unambiguous markers in the text only.
import fs from "node:fs";
import { evidence, mcp, record } from "./lib.mjs";

const queries = JSON.parse(fs.readFileSync("docs/audit/evidence/cloud-labels/sections.json", "utf8")).rows.map((r) => r.query).filter((q, i, a) => a.indexOf(q) === i);
const markers = [
  ["android-hms-core", /AbilitySlice|HiLogLabel|EMUI|HMS Core（APK）|HMS Core\(APK\)|Android|\.java\b|onNewToken|public class \w+ extends/],
  ["cangjie", /```cangjie|仓颉API|import kit\.\w+\.\*/],
  ["push-v1-clientid", /push-api\.cloud\.huawei\.com\/v1\/\[?clientid\]?/i],
];
const c = await mcp({ shared: true });
const rows = [];
for (const q of queries) {
  const r = (await c.call("knowledge", { action: "search", source: "cloud", query: q })).data;
  let full = "", line = 0;
  for (;;) { const p = (await c.call("job", { action: "read", artifact_id: r.full_artifact, line, limit: 2000 })).data; full += p.content + "\n"; if (p.next_line == null) break; line = p.next_line; }
  for (const sec of full.split(/(?=^\[\d+\]【)/m).filter((s) => /^\[\d+\]【/.test(s))) {
    const n = +/^\[(\d+)\]/.exec(sec)[1];
    // "official" = sections presented as ArkTS authority (official_other_platform is labelled separately)
    const label = /^\[\d+\]【官方文档·非/.test(sec) ? "official_other_platform" : /^\[\d+\]【官方/.test(sec) ? "official" : "other";
    const hits = markers.filter(([, re]) => re.test(sec)).map(([k]) => k);
    const src = r.sources.find((s) => s.n === n);
    rows.push({ query: q, n, label, title: src?.title, local_doc: src?.local_doc ?? null, markers: hits });
  }
}
await c.close();
const official = rows.filter((r) => r.label === "official");
const offPlatform = official.filter((r) => r.markers.some((m) => m === "android-hms-core" || m === "cangjie"));
const noLocal = official.filter((r) => !r.local_doc);
const stats = { sections: rows.length, official: official.length, official_without_local_doc: noLocal.length, official_other_platform: offPlatform.length,
  by_marker: Object.fromEntries(markers.map(([k]) => [k, official.filter((r) => r.markers.includes(k)).length])) };
const ev = evidence("cloud-labels", "platform.json", { stats, offPlatform, noLocal: noLocal.map((r) => ({ query: r.query, n: r.n, title: r.title, markers: r.markers })) });
record("B.knowledge.cloud.official-other-platform", offPlatform.length ? "DEFECT" : "VERIFIED",
  `${offPlatform.length} of ${official.length} 'official' sections are Huawei docs for another platform/language (HMS Core Android/Java ${stats.by_marker["android-hms-core"]}, Cangjie ${stats.by_marker.cangjie}); labelled official they would be treated as ArkTS authority`, [ev], { stats });
console.log(JSON.stringify(stats));
for (const r of offPlatform.slice(0, 30)) console.log("  ", r.markers.join(","), "|", r.title, "|", r.local_doc ? "local" : "no-local");
