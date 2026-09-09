import { openPromise } from "yauzl";
import { addAbortSignal } from "node:stream";
import { crc32 } from "node:zlib";
import { invariant } from "./errors.js";

/** Read one bounded ZIP member without buffering the HAP or extracting files. */
export async function archiveEntry(
  file: string,
  name: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  const zip = await openPromise(file, {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true,
    strictFileNames: true,
  });
  try {
    invariant(
      zip.entryCount <= 100000,
      "ARCHIVE_TOO_LARGE",
      "Archive has too many members",
    );
    let result: Buffer | undefined;
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      if (entry.fileName !== name) continue;
      invariant(
        !result,
        "ARCHIVE_MEMBER_AMBIGUOUS",
        "Archive has duplicate identity members",
      );
      invariant(
        entry.uncompressedSize <= limit && entry.compressedSize <= limit,
        "ARCHIVE_MEMBER_TOO_LARGE",
        "Archive member exceeds its size limit",
      );
      invariant(
        !entry.isEncrypted(),
        "ARCHIVE_ENCRYPTED",
        "Encrypted package metadata is unsupported",
      );
      const stream = await zip.openReadStreamPromise(entry);
      if (signal) addAbortSignal(signal, stream);
      const chunks: Buffer[] = [];
      let bytes = 0;
      try {
        for await (const value of stream) {
          const chunk: unknown = value;
          invariant(
            Buffer.isBuffer(chunk),
            "ARCHIVE_INVALID",
            "Expected binary archive data",
          );
          bytes += chunk.length;
          invariant(
            bytes <= limit,
            "ARCHIVE_MEMBER_TOO_LARGE",
            "Expanded archive member exceeds its size limit",
          );
          chunks.push(chunk);
        }
      } finally {
        stream.destroy();
      }
      result = Buffer.concat(chunks, bytes);
      invariant(
        crc32(result) === entry.crc32,
        "ARCHIVE_CRC_MISMATCH",
        "Package metadata failed its checksum",
      );
    }
    invariant(result, "ARCHIVE_MEMBER_MISSING", `Archive has no ${name}`);
    return result;
  } finally {
    if (zip.isOpen) {
      const closed = new Promise<void>((resolve) => zip.once("close", resolve));
      zip.close();
      await closed;
    }
  }
}
