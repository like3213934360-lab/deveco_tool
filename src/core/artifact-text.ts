import fs from "node:fs";
import { invariant } from "./errors.js";
import { grepMatcher } from "./grep.js";

/** Stream the file even when only counts are needed; retain a bounded page and grep batch. */
export async function readTextPage(file: string, options: { line?: number; offset?: number; limit?: number; grep?: string }, signal?: AbortSignal) {
  const start = Math.max(0, options.line ?? 0), offset = options.offset ?? 0;
  const limit = Math.min(Math.max(1, options.limit ?? 200), 2000), max = 60000;
  invariant(Number.isSafeInteger(offset) && offset >= 0, "INVALID_INPUT", "Invalid offset within artifact line");
  const matcher = options.grep ? grepMatcher(options.grep) : undefined;
  let total = 0, matched = 0, selected = 0, content = "", continuation = 0, stopped = false, offsetChecked = false;
  let current = "", length = 0, batchBytes = 0;
  const batch: { text: string; length: number }[] = [];
  const consume = (text: string, length: number) => {
    const index = matched++;
    if (index < start || stopped) return;
    const skip = index === start ? offset : 0;
    if (index === start) {
      invariant(skip <= length, "INVALID_INPUT", "Invalid offset within artifact line");
      offsetChecked = true;
    }
    // Non-grep lines have already skipped the requested offset while streaming.
    const value = matcher ? text.slice(skip) : text;
    const available = max - content.length - (selected ? 1 : 0);
    if (selected && (selected >= limit || length - skip > available)) { stopped = true; return; }
    let end = Math.min(value.length, available);
    if (/[\uD800-\uDBFF]/.test(value[end - 1] ?? "") && /[\uDC00-\uDFFF]/.test(value[end] ?? "")) end--;
    content += (selected ? "\n" : "") + value.slice(0, end);
    if (length - skip > end) { continuation = skip + end; stopped = true; }
    else selected++;
  };
  const flush = () => {
    if (!batch.length) return;
    const hits = matcher!(batch.map((row) => row.text));
    for (const [i, row] of batch.entries()) if (hits[i]) consume(row.text, row.length);
    batch.length = 0; batchBytes = 0;
  };
  const line = () => {
    if (matcher) {
      const text = `${total + 1}: ${current}`;
      batch.push({ text, length: text.length }); batchBytes += text.length;
      if (batch.length >= 64 || batchBytes >= 1024 * 1024) flush();
    } else consume(current, length);
    total++; current = ""; length = 0;
  };
  for await (const chunk of fs.createReadStream(file, { encoding: "utf8", highWaterMark: 65536, signal })) {
    signal?.throwIfAborted();
    let position = 0;
    while (position < chunk.length) {
      const newline = chunk.indexOf("\n", position), end = newline < 0 ? chunk.length : newline;
      const part = chunk.slice(position, end), previous = length;
      length += part.length;
      if (matcher) {
        invariant(length <= 1024 * 1024, "INVALID_INPUT", "Artifact grep cannot evaluate lines above 1 MiB; read the line with offset instead");
        current += part;
      } else if (!stopped && total >= start) {
        const skip = total === start ? offset : 0;
        const from = Math.max(0, skip - previous), to = Math.max(0, Math.min(part.length, skip + max + 1 - previous));
        if (to > from) current += part.slice(from, to);
      }
      if (newline < 0) break;
      line(); position = newline + 1;
    }
  }
  line(); flush(); // split("\n") includes the final empty line, including an empty file.
  invariant(offsetChecked || offset === 0, "INVALID_INPUT", "Invalid offset within artifact line");
  const next = start + selected;
  return { total_lines: total, ...(matcher ? { matched_lines: matched } : {}), line: start,
    next_line: next < matched ? next : null, next_offset: continuation, content };
}
