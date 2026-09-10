import fs from "node:fs";
import path from "node:path";
import { inflateRawSync, crc32 } from "node:zlib";
import type AdmZip from "adm-zip";
import { invariant } from "../../src/core/errors.js";

/** Never use adm-zip's filesystem extraction APIs. Bound allocation inside zlib:
 * a ZIP header is an untrusted claim, not a decompression limit. */
export function decodeZipEntry(entry: AdmZip.IZipEntry, bound: number) {
  invariant(
    entry.header.size <= bound &&
      [0, 8].includes(entry.header.method) &&
      !(entry.header.flags & 0x41),
    "ARCHIVE_ENTRY_INVALID",
    "ZIP entry exceeds its budget or uses unsupported compression/encryption",
  );
  const compressed = entry.getCompressedData();
  const data =
    entry.header.method === 0
      ? compressed
      : inflateRawSync(compressed, {
          maxOutputLength: Math.max(1, entry.header.size),
        });
  invariant(
    data.length === entry.header.size && crc32(data) === entry.header.crc,
    "ARCHIVE_ENTRY_INVALID",
    "ZIP entry size or CRC mismatch",
  );
  return data;
}

/** mkdir is exclusive, including for dangling destination symlinks. Only the
 * fresh private root we created is cleaned on failure; existing paths survive. */
export function writeArchiveDirectory<T>(output: string, write: () => T): T {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output, { mode: 0o700 });
  try {
    return write();
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}
