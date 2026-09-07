import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import { z } from "zod";
import { resourceRoot } from "../core/config.js";
import { fileDigest, inside } from "../core/files.js";
import { invariant } from "../core/errors.js";
import { StateStore } from "../core/store.js";
import { AuthService, httpRequest } from "./auth.js";

export const knowledgeEntrySchema = z.strictObject({
  id: z.string(),
  file: z.string(),
  title: z.string(),
  source: z.string(),
  commit: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  applicability: z.string(),
  source_path: z.string(),
  kind: z.enum(["rule", "case", "example"]),
  summary: z.string(),
  related_ids: z.array(z.string()),
});
interface Doc {
  document_id: string;
  doc_title: string;
}
export class KnowledgeService {
  private readonly entries = z
    .array(knowledgeEntrySchema)
    .parse(
      JSON.parse(
        fs.readFileSync(path.join(resourceRoot, "knowledge.json"), "utf8"),
      ) as unknown,
    );
  private index?: Database.Database;
  private archive?: AdmZip;
  constructor(
    readonly store: StateStore,
    readonly auth: AuthService,
  ) {}
  private documents(): Database.Database {
    if (this.index) return this.index;
    // The release archive compresses this database. Opening the installed file
    // read-only avoids copying each release's index into mutable user state.
    const file = path.join(resourceRoot, "docs/search.db");
    this.index = new Database(file, { readonly: true, fileMustExist: true });
    this.index.pragma("query_only = ON");
    return this.index;
  }
  catalog(offset = 0, limit = 50, kind: "rules" | "docs" = "rules") {
    if (kind === "rules")
      return {
        source: "local",
        total: this.entries.length,
        entries: this.entries
          .slice(offset, offset + limit)
          .map(({ file: _file, ...entry }) => entry),
      };
    const database = this.documents();
    const count = database
      .prepare("SELECT COUNT(*) AS count FROM documents")
      .get() as { count: number };
    const documents = database
      .prepare(
        "SELECT document_id,doc_title FROM documents ORDER BY document_id LIMIT ? OFFSET ?",
      )
      .all(limit, offset) as Doc[];
    return {
      source: "local",
      total: count.count,
      entries: documents.map((doc) => ({
        id: `docs:${doc.document_id}`,
        title: doc.doc_title,
        source: "deveco-cli/docs.zip",
      })),
    };
  }
  search(query: string, limit = 20, kind: "rules" | "docs" = "rules") {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    invariant(
      terms.length > 0,
      "QUERY_REQUIRED",
      "Search query must not be empty",
    );
    const rules = (kind === "rules" ? this.entries : [])
      .map((entry) => {
        const file = inside(resourceRoot, entry.file);
        invariant(
          fileDigest(file) === entry.sha256,
          "KNOWLEDGE_DIGEST_MISMATCH",
          "Bundled knowledge failed integrity verification",
        );
        const content = fs.readFileSync(file, "utf8");
        const lower = content.toLocaleLowerCase();
        const score = terms.reduce(
          (score, term) =>
            score +
            (entry.title.toLocaleLowerCase().includes(term) ? 5 : 0) +
            (lower.includes(term) ? 1 : 0),
          0,
        );
        const at = Math.max(0, lower.indexOf(terms[0]!));
        return {
          id: entry.id,
          title: entry.title,
          score,
          excerpt: content.slice(Math.max(0, at - 100), at + 500),
          source: entry.source,
          commit: entry.commit,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (kind === "rules") return { source: "local", rules, documents: [] };
    const expression = terms
      .slice(0, 12)
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" OR ");
    const database = this.documents();
    let documents = database
      .prepare(
        "SELECT DISTINCT d.document_id,d.doc_title FROM segments_fts f JOIN segments s ON s.id=f.rowid JOIN documents d ON d.id=s.doc_id WHERE segments_fts MATCH ? LIMIT ?",
      )
      .all(expression, limit) as Doc[];
    if (documents.length < limit) {
      const escaped = query
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
      const titles = database
        .prepare(
          "SELECT document_id,doc_title FROM documents WHERE doc_title LIKE ? ESCAPE '\\' LIMIT ?",
        )
        .all(`%${escaped}%`, limit) as Doc[];
      documents = [
        ...new Map(
          [...titles, ...documents].map((doc) => [doc.document_id, doc]),
        ).values(),
      ].slice(0, limit);
    }
    return {
      source: "local",
      rules,
      documents: documents.map((doc) => ({
        id: `docs:${doc.document_id}`,
        title: doc.doc_title,
        source: "deveco-cli/docs.zip",
      })),
    };
  }
  read(id: string, offset = 0, limit = 16384) {
    let content: string, source: unknown;
    if (id.startsWith("docs:")) {
      const document = this.documents()
        .prepare(
          "SELECT document_id,doc_title FROM documents WHERE document_id=?",
        )
        .get(id.slice(5)) as Doc | undefined;
      invariant(document, "KNOWLEDGE_NOT_FOUND", "Unknown document");
      this.archive ??= new AdmZip(path.join(resourceRoot, "docs.zip"));
      const entry = this.archive.getEntry(`${document.document_id}.md`);
      invariant(
        entry && entry.header.size <= 8 * 1024 * 1024,
        "DOCS_ENTRY_MISSING",
        "Document content is missing or too large",
      );
      content = entry.getData().toString("utf8");
      source = {
        id,
        title: document.doc_title,
        source: "deveco-cli/docs.zip",
        version: "1.3.1",
      };
    } else {
      const entry = this.entries.find((entry) => entry.id === id);
      invariant(entry, "KNOWLEDGE_NOT_FOUND", "Unknown knowledge entry");
      const file = inside(resourceRoot, entry.file);
      invariant(
        fileDigest(file) === entry.sha256,
        "KNOWLEDGE_DIGEST_MISMATCH",
        "Bundled knowledge failed integrity verification",
      );
      content = fs.readFileSync(file, "utf8");
      const { file: _file, ...metadata } = entry;
      source = metadata;
    }
    return {
      source,
      content: content.slice(offset, offset + limit),
      offset,
      next_offset: Math.min(content.length, offset + limit),
      total_characters: content.length,
    };
  }
  async cloud(query: string, signal?: AbortSignal) {
    let data: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = await this.auth.credentials(
        "codegenie",
        signal,
        attempt > 0,
      );
      data = JSON.parse(
        await httpRequest(
          "https://cn.devecostudio.huawei.com/codeGenie/bigSearch",
          {
            method: "POST",
            headers: {
              Authorization: auth.access,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ question: query }),
          },
          signal,
        ),
      ) as unknown;
      const expired = z.object({ error_code: z.literal(4016) }).safeParse(data);
      if (!expired.success) break;
    }
    const result = z
      .object({
        code: z.literal(200),
        body: z.object({ answer: z.object({ prompt: z.string() }) }),
      })
      .safeParse(data);
    invariant(
      result.success,
      "CLOUD_KNOWLEDGE_FAILED",
      "Cloud knowledge returned no valid answer",
    );
    const prompt = result.data.body.answer.prompt,
      marker = "【检索信息】：",
      index = prompt.indexOf(marker);
    const content = index < 0 ? prompt : prompt.slice(index + marker.length);
    return {
      source: "cloud",
      content: content.slice(0, 16384),
      ...(content.length > 16384
        ? { artifact: this.store.artifact("knowledge", content) }
        : {}),
    };
  }
  close() {
    this.index?.close();
    this.index = undefined;
    this.archive = undefined;
  }
}
