import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import { z } from "zod";
import { resourceRoot } from "../core/config.js";
import { fileDigest, inside } from "../core/files.js";
import { invariant } from "../core/errors.js";
import { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";
import { AuthService, httpRequest } from "./auth.js";
import {
  compileCrashReference,
  matchCrashPatterns,
  type CrashPattern,
} from "./crash-patterns.js";
import {
  docCatalogNames,
  docCatalogTitles,
  type DocCatalog,
} from "../core/doc-catalog.js";

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
const docSchema = z.object({
  document_id: z.string(),
  doc_title: z.string(),
  catalog_id: z.number().int().nonnegative(),
});
type Doc = z.infer<typeof docSchema>;
function docMetadata(doc: Doc) {
  const catalog = docCatalogNames[doc.catalog_id];
  invariant(
    catalog,
    "DOC_CATALOG_INVALID",
    "Bundled document has an unknown catalog",
  );
  return {
    id: `docs:${doc.document_id}`,
    title: doc.doc_title,
    catalog,
    source: "deveco-cli/docs.zip",
  };
}
function catalogId(catalog: DocCatalog): number | null {
  if (catalog === "all") return null;
  const id = docCatalogNames.indexOf(catalog);
  invariant(id >= 0, "DOC_CATALOG_INVALID", "Unknown documentation catalog");
  return id;
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
  private runtimePatterns?: CrashPattern[];
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
  catalog(
    offset = 0,
    limit = 50,
    kind: "rules" | "docs" = "rules",
    catalog: DocCatalog = "all",
  ) {
    if (kind === "rules")
      return {
        source: "local",
        total: this.entries.length,
        offset,
        next_offset: Math.min(this.entries.length, offset + limit),
        entries: this.entries
          .slice(offset, offset + limit)
          .map(({ file: _file, ...entry }) => entry),
      };
    const database = this.documents();
    const id = catalogId(catalog);
    const counts = z
      .array(
        z.object({ catalog_id: z.number().int(), count: z.number().int() }),
      )
      .parse(
        database
          .prepare(
            "SELECT catalog_id,COUNT(*) AS count FROM documents GROUP BY catalog_id",
          )
          .all(),
      );
    invariant(
      counts.every((row) => docCatalogNames[row.catalog_id]),
      "DOC_CATALOG_INVALID",
      "Bundled document index has an unknown catalog",
    );
    const catalogs = docCatalogNames.map((name, i) => ({
      name,
      title: docCatalogTitles[i],
      total: counts.find((row) => row.catalog_id === i)?.count ?? 0,
    }));
    const total = catalogs.reduce(
      (sum, item, i) => sum + (id === null || id === i ? item.total : 0),
      0,
    );
    const documents = z
      .array(docSchema)
      .parse(
        database
          .prepare(
            "SELECT document_id,doc_title,catalog_id FROM documents WHERE (? IS NULL OR catalog_id=?) ORDER BY document_id LIMIT ? OFFSET ?",
          )
          .all(id, id, limit, offset),
      );
    return {
      source: "local",
      total,
      offset,
      next_offset: Math.min(total, offset + limit),
      catalogs,
      entries: documents.map(docMetadata),
    };
  }
  search(
    query: string,
    limit = 20,
    kind: "rules" | "docs" = "rules",
    catalog: DocCatalog = "all",
    offset = 0,
  ) {
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
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (kind === "rules")
      return {
        source: "local",
        rules: rules.slice(offset, offset + limit),
        documents: [],
        total: rules.length,
        offset,
        next_offset: Math.min(rules.length, offset + limit),
      };
    invariant(
      terms.length <= 12,
      "QUERY_TOO_COMPLEX",
      "Local documentation search accepts at most 12 whitespace-separated terms",
    );
    const expression = terms
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" OR ");
    const database = this.documents();
    const id = catalogId(catalog),
      escaped = query
        .trim()
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_"),
      // Title hits first, then full-text hits, with a stable ID tie-breaker.
      // All candidates stay in SQLite; LIMIT/OFFSET cannot silently change
      // directory filtering or duplicate documents across pages.
      matches = `WITH hits AS (
        SELECT id AS doc_id,1 AS title_hit FROM documents WHERE doc_title LIKE ? ESCAPE '\\' AND (? IS NULL OR catalog_id=?)
        UNION ALL
        SELECT s.doc_id,0 AS title_hit FROM segments_fts f JOIN segments s ON s.id=f.rowid JOIN documents d ON d.id=s.doc_id WHERE segments_fts MATCH ? AND (? IS NULL OR d.catalog_id=?)
      ), matched AS (SELECT doc_id,MAX(title_hit) AS title_hit FROM hits GROUP BY doc_id)`,
      args = [`%${escaped}%`, id, id, expression, id, id],
      total = z
        .object({ total: z.number().int() })
        .parse(
          database
            .prepare(`${matches} SELECT COUNT(*) AS total FROM matched`)
            .get(...args),
        ).total,
      documents = z
        .array(docSchema)
        .parse(
          database
            .prepare(
              `${matches} SELECT d.document_id,d.doc_title,d.catalog_id FROM matched m JOIN documents d ON d.id=m.doc_id ORDER BY m.title_hit DESC,d.document_id LIMIT ? OFFSET ?`,
            )
            .all(...args, limit, offset),
        );
    return {
      source: "local",
      rules,
      total,
      offset,
      next_offset: Math.min(total, offset + limit),
      documents: documents.map(docMetadata),
    };
  }
  crashCases(raw: unknown) {
    const signature = z
      .object({
        status: z.enum([
          "detected",
          "insufficient_evidence",
          "no_crash_signature",
        ]),
        kind: z.string().max(256),
        error_message: z.string().max(2048).nullable(),
        error_code: z.string().max(64).nullable(),
        selection_complete: z.boolean(),
      })
      .parse(raw);
    if (!this.runtimePatterns) {
      const entries = this.entries.filter((entry) =>
        entry.id.startsWith("arkts-runtime-fix/"),
      );
      invariant(
        entries.length > 0 && entries.length <= 16,
        "CRASH_KNOWLEDGE_MISSING",
        "Reviewed runtime case references are missing or exceed the bound",
      );
      this.runtimePatterns = entries.flatMap((entry) => {
        const file = inside(resourceRoot, entry.file);
        invariant(
          fileDigest(file) === entry.sha256,
          "KNOWLEDGE_DIGEST_MISMATCH",
          "Runtime case reference failed integrity verification",
        );
        return compileCrashReference(entry.id, fs.readFileSync(file, "utf8"));
      });
    }
    const matches = matchCrashPatterns(this.runtimePatterns, signature);
    const selected =
      signature.status === "detected"
        ? this.runtimePatterns.filter(
            (pattern) =>
              pattern.error_name === signature.kind ||
              (pattern.error_name === "Error" && signature.kind === "ApiError"),
          )
        : [];
    const ids = new Set(selected.map((pattern) => pattern.source_id));
    return {
      source: "local",
      matches,
      status:
        signature.status !== "detected"
          ? "evidence_required"
          : matches.length
            ? "candidate_patterns"
            : ids.size
              ? "unlisted_subtype"
              : "unlisted_error_type",
      // Only metadata is returned; complete references remain available through harmony_knowledge.read.
      references: this.entries
        .filter((entry) => ids.has(entry.id))
        .map(({ file: _file, ...entry }) => entry),
      root_cause_verified: false,
    };
  }
  read(id: string, offset = 0, limit = 16384) {
    let content: string, source: unknown;
    if (id.startsWith("docs:")) {
      const document = docSchema
        .optional()
        .parse(
          this.documents()
            .prepare(
              "SELECT document_id,doc_title,catalog_id FROM documents WHERE document_id=?",
            )
            .get(id.slice(5)),
        );
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
        ...docMetadata(document),
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
        ? {
            artifact: this.store.artifact(
              currentTrace().run_id ?? "knowledge",
              content,
            ),
          }
        : {}),
    };
  }
  close() {
    this.index?.close();
    this.index = undefined;
    this.archive = undefined;
  }
}
