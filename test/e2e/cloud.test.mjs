// Cloud retrieval must expose every source exactly once with valid line pointers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { session } from "../support/acceptance.mjs";

const queries = ["Push Kit 获取 Push Token tokenUpdate", "Navigation 路由跳转 NavPathStack pushPath", "@ComponentV2 @Local @Param 状态管理",
  "LazyForEach 列表性能优化", "PersistenceV2 AppStorageV2 数据持久化", "Web组件 JavaScript 交互 runJavaScript", "相机 Camera Kit 拍照 预览", "卡片 FormExtensionAbility 刷新"];
const norm = (s) => s.replace(/[#*`>|\-\[\]()\s]/g, "");

test("cloud source completeness and independent document overlap", async (t) => {
  const { call, receipt } = await session(t);
  for (const [index, query] of queries.entries()) await t.test(query, async () => {
    const result = await call("knowledge", { action: "search", source: "cloud", query });
    let full = "", line = 0;
    for (;;) {
      const page = await call("job", { action: "read", artifact_id: result.full_artifact, line, limit: 2000 });
      full += page.content + "\n";
      if (page.next_line == null) break;
      assert.ok(page.next_line > line); line = page.next_line;
    }
    const heads = [...full.matchAll(/^\[(\d+)\]【/gm)].map((m) => +m[1]), lines = full.split("\n");
    assert.ok(result.sources.length > 0); assert.equal(heads.length, result.sources.length); assert.equal(new Set(heads).size, heads.length);
    const rows = [];
    for (const source of result.sources) {
      assert.ok(lines[source.line].startsWith(`[${source.n}]【`));
      const section = full.split(/(?=^\[\d+\]【)/m).find((s) => s.startsWith(`[${source.n}]【`));
      if (source.origin === "official") assert.doesNotMatch(section, /AbilitySlice|HiLogLabel|EMUI|Android|\.java\b|onNewToken|public class \w+ extends|```cangjie|仓颉API|import kit\.\w+\.\*/);
      const body = norm(section.slice(section.indexOf("网页内容：") + 5)), shingles = new Set();
      for (let i = 0; i + 12 <= body.length; i += 6) shingles.add(body.slice(i, i + 12));
      const hits = (await call("knowledge", { action: "search", query: source.title, kind: "docs", limit: 5 })).results;
      const candidates = new Set([...(source.local_doc ? [source.local_doc] : []), ...hits.map((h) => h.id)]);
      let best = { id: null, overlap: 0 };
      for (const id of candidates) {
        let text = "", offset = 0;
        for (;;) {
          const doc = await call("knowledge", { action: "read", id, offset, limit: 40000 }); text += doc.content;
          if (!doc.next) break;
          assert.ok(doc.next.offset > offset); offset = doc.next.offset;
        }
        const normalized = norm(text), overlap = shingles.size ? [...shingles].filter((s) => normalized.includes(s)).length / shingles.size : 0;
        if (overlap > best.overlap) best = { id, overlap };
      }
      const truth = shingles.size < 5 ? "undetermined" : best.overlap >= 0.5 ? "official" : best.overlap <= 0.1 ? "community" : "undetermined";
      rows.push({ source, truth, best });
      if (truth === "undetermined") t.diagnostic(`UNVERIFIED overlap: ${source.title}`);
      else {
        assert.equal(source.origin === "official_other_platform" ? "official" : source.origin, truth);
        if (truth === "official" && source.local_doc) assert.equal(source.local_doc, best.id);
      }
    }
    receipt(`overlap-${index}.json`, rows);
    assert.ok(rows.some((r) => r.truth !== "undetermined"), "No independently decidable source");
  });
});
