// Cloud retrieval must expose every source exactly once with valid line pointers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { session } from "../support/acceptance.mjs";

const queries = ["Push Kit 获取 Push Token tokenUpdate", "Navigation 路由跳转 NavPathStack pushPath", "@ComponentV2 @Local @Param 状态管理",
  "LazyForEach 列表性能优化", "PersistenceV2 AppStorageV2 数据持久化", "Web组件 JavaScript 交互 runJavaScript", "相机 Camera Kit 拍照 预览", "卡片 FormExtensionAbility 刷新"];
const norm = (s) => s.replace(/[#*`>|\-\[\]()\s]/g, "").toLowerCase();

test("cloud source completeness and independent official text evidence", async (t) => {
  const { call, receipt } = await session(t);
  for (const [index, query] of queries.entries()) await t.test(query, async (t) => {
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
    const rows = [], documents = new Map();
    for (const source of result.sources) await t.test(`source ${source.n}: ${source.title}`, async () => {
      assert.ok(lines[source.line].startsWith(`[${source.n}]【`));
      const section = full.split(/(?=^\[\d+\]【)/m).find((s) => s.startsWith(`[${source.n}]【`));
      if (!["official", "official_other_platform"].includes(source.origin)) {
        assert.equal(source.origin, "unverified");
        rows.push({ source, publisher: "unverified" });
        return;
      }
      assert.ok(source.local_doc, "Official text labels require a readable local evidence document");
      const id = source.local_doc;
      if (!documents.has(id)) {
        let text = "", offset = 0;
        for (;;) {
          const doc = await call("knowledge", { action: "read", id, offset, limit: 40000 }); text += doc.content;
          if (!doc.next) break;
          assert.ok(doc.next.offset > offset); offset = doc.next.offset;
        }
        documents.set(id, norm(text));
      }
      // Independent passage evidence ignoring markup/spacing/case, not the product's shingle scoring rule.
      const body = norm(section.slice(section.indexOf("网页内容：") + 5));
      let quotation = false;
      for (let i = 0; i + 48 <= body.length; i += 24)
        if (documents.get(id).includes(body.slice(i, i + 48))) { quotation = true; break; }
      assert.equal(quotation, true, "Labelled official text must contain a substantial exact passage from its evidence document");
      rows.push({ source, quotation_verified: true, publisher: "unverified" });
    });
    receipt(`text-evidence-${index}.json`, rows);
    assert.ok(rows.some((r) => r.quotation_verified), "No independently verified official text");
  });
});
