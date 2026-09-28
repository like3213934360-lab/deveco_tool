import fs from "node:fs";
import path from "node:path";
import { inside } from "./files.js";

/** Extract a zip with yauzl (no external unzip binary; works on Windows). Rejects path traversal. */
export async function extractZip(zipFile: string, destination: string): Promise<string[]> {
  const yauzl = (await import("yauzl")).default;
  fs.mkdirSync(destination, { recursive: true });
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true, decodeStrings: false }, (error, zip) => {
      if (error || !zip) return reject(error);
      const written: string[] = [];
      zip.on("entry", (entry: import("yauzl").Entry) => {
        const name = Buffer.isBuffer(entry.fileName) ? (entry.fileName as unknown as Buffer).toString("utf8") : String(entry.fileName);
        const target = inside(destination, name);
        if (name.endsWith("/")) {
          fs.mkdirSync(target, { recursive: true });
          zip.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err);
          const out = fs.createWriteStream(target);
          stream.pipe(out);
          out.on("finish", () => { written.push(target); zip.readEntry(); });
          out.on("error", reject);
        });
      });
      zip.on("end", () => resolve(written));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
