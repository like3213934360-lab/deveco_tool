import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { crc32 } from "node:zlib";
import { inside } from "./files.js";

/** Extract entries serially; archive, validation and stream errors reject the operation. */
export async function extractZip(zipFile: string, destination: string, verifyCrc = false): Promise<string[]> {
  const yauzl = (await import("yauzl")).default;
  fs.mkdirSync(destination, { recursive: true });
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true, decodeStrings: false }, (error, zip) => {
      if (error || !zip) return reject(error);
      const written: string[] = [];
      let failed = false;
      const fail = (error: unknown) => { if (!failed) { failed = true; zip.close(); reject(error); } };
      zip.on("entry", (entry: import("yauzl").Entry) => {
        void (async () => {
          const name = Buffer.isBuffer(entry.fileName) ? (entry.fileName as unknown as Buffer).toString("utf8") : String(entry.fileName);
          const target = inside(destination, name);
          if (name.endsWith("/")) fs.mkdirSync(target, { recursive: true });
          else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
              zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error) : resolve(stream));
            });
            if (verifyCrc) {
              let checksum = 0, bytes = 0;
              const verify = new Transform({ transform(chunk: Buffer, _encoding, done) { checksum = crc32(chunk, checksum); bytes += chunk.length; done(null, chunk); } });
              await pipeline(stream, verify, fs.createWriteStream(target));
              if (bytes !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error(`ZIP entry checksum mismatch: ${name}`);
            } else await pipeline(stream, fs.createWriteStream(target));
            written.push(target);
          }
          if (!failed) zip.readEntry();
        })().catch(fail);
      });
      zip.on("end", () => { if (!failed) resolve(written); });
      zip.on("error", fail);
      zip.readEntry();
    });
  });
}
