import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { resourceRoot } from "../core/config.js";
import { digest, inside } from "../core/files.js";
import { invariant } from "../core/errors.js";
import type { StateStore } from "../core/store.js";

const name = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const relative = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
  .refine(
    (value) => !value.split("/").some((part) => part === "." || part === ".."),
  );
export const skillCatalogSchema = z.strictObject({
  format: z.literal(1),
  skills: z
    .array(
      z.strictObject({
        name,
        description: z.string().min(1).max(1024),
        version: z.string().min(1).max(128),
        upstream: z.strictObject({
          url: z.string().url(),
          commit: z.string().regex(/^[a-f0-9]{40}$/),
          path: relative,
          sha256: sha,
        }),
        files: z
          .array(z.strictObject({ path: relative, sha256: sha }))
          .min(1)
          .max(64),
      }),
    )
    .min(1)
    .max(100),
});
export const skillManageSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("catalog"),
    query: z.string().trim().max(256).default(""),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  z.strictObject({
    action: z.literal("read"),
    name,
    file: relative.default("SKILL.md"),
  }),
]);
const bytesHash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** Bundled instructions are delivered over MCP. No host-directory installation. */
export class SkillService {
  private readonly entries;
  constructor(
    readonly store: StateStore,
    readonly resources = resourceRoot,
  ) {
    this.entries = skillCatalogSchema.parse(
      JSON.parse(
        this.readFile(path.join(resources, "skills.json")).toString("utf8"),
      ),
    ).skills;
    invariant(
      new Set(this.entries.map((entry) => entry.name)).size ===
        this.entries.length,
      "SKILL_CATALOG_INVALID",
      "Duplicate skill names",
    );
    for (const entry of this.entries) {
      invariant(
        entry.files.some((file) => file.path === "SKILL.md") &&
          new Set(entry.files.map((file) => file.path)).size ===
            entry.files.length &&
          entry.files.every((file) => /\.(md|yaml|json|txt)$/.test(file.path)),
        "SKILL_CATALOG_INVALID",
        "Skills require a unique entrypoint and instruction-only files",
      );
    }
  }
  private readFile(file: string) {
    invariant(
      !fs.lstatSync(file).isSymbolicLink(),
      "SKILL_FILE_INVALID",
      "Linked skill files cannot be managed",
    );
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      const stat = fs.fstatSync(fd);
      invariant(
        stat.isFile() && stat.size <= 256 * 1024,
        "SKILL_FILE_INVALID",
        "Skill content must be a regular file at most 256 KiB",
      );
      const buffer = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const read = fs.readSync(
          fd,
          buffer,
          offset,
          buffer.length - offset,
          null,
        );
        if (!read) break;
        offset += read;
      }
      const bytes = buffer.subarray(0, offset),
        after = fs.fstatSync(fd);
      invariant(
        after.size === stat.size &&
          after.mtimeMs === stat.mtimeMs &&
          after.ctimeMs === stat.ctimeMs &&
          bytes.length === stat.size,
        "SKILL_FILE_CHANGED",
        "Skill file changed during read",
      );
      return bytes;
    } finally {
      fs.closeSync(fd);
    }
  }
  private entry(id: string) {
    const entry = this.entries.find((entry) => entry.name === id);
    invariant(
      entry,
      "SKILL_NOT_FOUND",
      "Use skill_manage catalog to find a bundled skill name",
    );
    return entry;
  }
  private metadata(entry: (typeof this.entries)[number]) {
    return {
      ...entry,
      source: "reviewed_native_adaptation",
      delivery: "mcp",
      client_installation_required: false,
      package_sha256: digest(entry),
    };
  }
  read(id: string, fileName = "SKILL.md") {
    const entry = this.entry(id),
      file = entry.files.find((file) => file.path === fileName);
    invariant(
      file,
      "SKILL_FILE_NOT_FOUND",
      "Read only files listed in the skill catalog",
    );
    const content = this.readFile(
      inside(path.join(this.resources, "skills", entry.name), fileName),
    );
    invariant(
      bytesHash(content) === file.sha256,
      "SKILL_INTEGRITY",
      "Packaged skill content differs from the reviewed catalog",
    );
    return {
      ...this.metadata(entry),
      file: fileName,
      content: content.toString("utf8"),
      reference_read: {
        tool: "skill_manage",
        action: "read",
        name: entry.name,
      },
    };
  }
  call(raw: unknown, signal?: AbortSignal) {
    const input = skillManageSchema.parse(raw);
    signal?.throwIfAborted();
    if (input.action === "catalog") {
      const query = input.query.toLocaleLowerCase(),
        matches = this.entries.filter((entry) =>
          `${entry.name} ${entry.description} ${entry.upstream.path}`
            .toLocaleLowerCase()
            .includes(query),
        );
      return {
        total: matches.length,
        next_offset: Math.min(matches.length, input.offset + input.limit),
        skills: matches
          .slice(input.offset, input.offset + input.limit)
          .map((entry) => this.metadata(entry)),
      };
    }
    return this.read(input.name, input.file);
  }
}
