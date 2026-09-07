import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import type { z } from "zod";
import { tools, selectorSchema } from "../core/contracts.js";
import type { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";
import type { CpuPool } from "../core/cpu-pool.js";
import { invariant, ToolError } from "../core/errors.js";
import { parseUiDump } from "./ui-parse.js";
import { UiIndex, type UiNode } from "./ui-tree.js";
import type { SavedUiTreeCache } from "./ui-import-cache.js";

const maximum = 32 * 1024 * 1024;
export async function readUiTreeFile(file: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  invariant(
    path.isAbsolute(file),
    "UI_TREE_PATH_INVALID",
    "A saved UI tree requires an absolute file path",
  );
  // Nonblocking open prevents a named pipe from hanging before the regular-file check.
  const handle = await fs.promises
    .open(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0))
    .catch((error: unknown) => {
      throw new ToolError(
        "UI_TREE_FILE_INVALID",
        "Saved UI tree cannot be opened for reading",
        {
          cause:
            error instanceof Error && "code" in error ? error.code : "unknown",
        },
      );
    });
  try {
    const before = await handle.stat({ bigint: true });
    invariant(
      before.isFile() && before.size > 0 && before.size <= maximum,
      "UI_TREE_FILE_INVALID",
      "UI tree must be a nonempty regular file at most 32 MiB",
    );
    const bytes = Buffer.allocUnsafe(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        Math.min(65536, bytes.length - offset),
        offset,
      );
      invariant(
        bytesRead > 0,
        "UI_TREE_FILE_CHANGED",
        "UI tree was truncated while reading",
      );
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    invariant(
      after.size === before.size &&
        after.mtimeNs === before.mtimeNs &&
        after.ctimeNs === before.ctimeNs,
      "UI_TREE_FILE_CHANGED",
      "UI tree changed while reading",
    );
    signal?.throwIfAborted();
    return bytes;
  } finally {
    await handle.close();
  }
}
async function readUiTreeArtifact(
  store: StateStore,
  id: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const first = store.readArtifact(id, 0, 65536);
  invariant(
    first.bytes > 0 &&
      first.bytes <= maximum &&
      first.mime === "application/json",
    "UI_TREE_ARTIFACT_INVALID",
    "UI tree artifact must contain JSON within 32 MiB",
  );
  const parts = [Buffer.from(first.data, "base64")];
  for (let offset = first.next_offset; offset < first.bytes;) {
    await setImmediate(undefined, { signal });
    const part = store.readArtifact(id, offset, 65536);
    invariant(
      part.bytes === first.bytes && part.next_offset > offset,
      "UI_TREE_ARTIFACT_CHANGED",
      "UI tree artifact changed while reading",
    );
    parts.push(Buffer.from(part.data, "base64"));
    offset = part.next_offset;
  }
  return Buffer.concat(parts);
}
export async function findInSavedTree(
  raw: z.infer<typeof tools.ui_find.schema>,
  store: StateStore,
  cpu: CpuPool,
  signal?: AbortSignal,
  cache?: SavedUiTreeCache,
) {
  const input = tools.ui_find.schema.parse(raw);
  invariant(
    input.tree_file || input.tree_artifact_id,
    "UI_TREE_SOURCE_REQUIRED",
    "Provide one saved tree source",
  );
  const bytes = input.tree_file
    ? await readUiTreeFile(input.tree_file, signal)
    : await readUiTreeArtifact(store, input.tree_artifact_id!, signal);
  const format = input.tree_format ?? "uitest",
    sha256 = createHash("sha256").update(bytes).digest("hex"),
    cacheKey = `${format}:${sha256}`,
    cached = cache?.get(cacheKey);
  let parsed: ReturnType<typeof parseUiDump>;
  let index: UiIndex;
  if (cached) {
    parsed = cached.parsed;
    index = cached.index;
  } else {
    // A fatal decoder prevents invalid UTF-8 from silently changing selectors.
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ToolError(
        "UI_TREE_ENCODING_INVALID",
        "Saved UI tree must be valid UTF-8 JSON",
      );
    }
    signal?.throwIfAborted();
    try {
      parsed =
        bytes.length >= 128 * 1024
          ? await cpu.run({ kind: "ui", content, format }, signal)
          : parseUiDump(content, format);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ToolError(
          "UI_TREE_INVALID",
          "Saved UI tree is not valid JSON",
        );
      throw error;
    }
    invariant(
      parsed.nodes.some(
        (node) => node.type || node.key || node.text || node.rect,
      ),
      "UI_TREE_INVALID",
      "Saved UI tree contains no recognizable UI attributes",
    );
    signal?.throwIfAborted();
    index = new UiIndex(parsed.nodes);
    cache?.put(cacheKey, parsed, index, bytes.length);
  }
  signal?.throwIfAborted();
  let remainingBytes = 24 * 1024,
    contentTruncated = false;
  const query = (selector: z.infer<typeof selectorSchema>) => {
    const found = index.select(selector),
      matches: (UiNode & { truncated_fields: string[] })[] = [];
    for (const node of found.slice(0, selector.limit)) {
      const preview = { ...node, rect: node.rect ? { ...node.rect } : null },
        fields: string[] = [];
      for (const field of [
        "id",
        "type",
        "key",
        "text",
        "value",
        "displayId",
        "windowId",
        "bundleName",
        "abilityName",
        "pagePath",
      ] as const) {
        const value = preview[field];
        if (typeof value === "string" && value.length > 1024) {
          preview[field] = value.slice(0, 1024).replace(/[\uD800-\uDBFF]$/, "");
          fields.push(field);
        }
      }
      const item = { ...preview, truncated_fields: fields },
        size = Buffer.byteLength(JSON.stringify(item));
      if (size > remainingBytes) {
        contentTruncated = true;
        break;
      }
      if (fields.length) contentTruncated = true;
      remainingBytes -= size;
      matches.push(item);
    }
    return {
      match_count: found.length,
      matches,
      truncated:
        found.length > matches.length ||
        matches.some((item) => item.truncated_fields.length > 0),
    };
  };
  const results = input.selectors
    ? {
        queries: input.selectors.map(({ id, selector }) => ({
          id,
          ...query(selector),
        })),
      }
    : query(input.selector ?? selectorSchema.parse({}));
  const tree = contentTruncated
    ? {
        format,
        ...(input.tree_artifact_id
          ? { artifact_id: input.tree_artifact_id }
          : store.artifact(
              currentTrace().run_id ?? "ui-import",
              bytes,
              "application/json",
            )),
      }
    : undefined;
  return {
    source: "saved_tree" as const,
    device_state_verified: false,
    input: {
      format,
      bytes: bytes.length,
      sha256,
      ...(input.tree_file
        ? { file: input.tree_file }
        : { artifact_id: input.tree_artifact_id }),
    },
    signature: parsed.signature,
    structure_signature: parsed.structureSignature,
    node_count: parsed.nodes.length,
    preview_truncated: contentTruncated,
    ...(tree ? { tree } : {}),
    ...results,
  };
}
