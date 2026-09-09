import crypto from "node:crypto";
import fs from "node:fs";
import { invariant } from "./errors.js";

/** Publish a fully written key atomically so simultaneous runtimes never read a partial key. */
export function localKey(file: string): Buffer {
  if (!fs.existsSync(file)) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`,
      key = crypto.randomBytes(32),
      fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, key);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
      key.fill(0);
    }
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  invariant(
    fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),
    "SECRET_KEY_UNSAFE",
    "Encryption key must be a regular file",
  );
  const key = fs.readFileSync(file);
  invariant(
    key.length === 32,
    "SECRET_KEY_INVALID",
    "Invalid local encryption key",
  );
  return key;
}
export class PayloadCipher {
  private readonly key: Buffer;
  constructor(file: string) {
    this.key = localKey(file);
  }
  seal(id: string, payload: string): string {
    return this.sealBytes(id, Buffer.from(payload)).toString("base64");
  }
  sealBytes(id: string, payload: Buffer): Buffer {
    const iv = crypto.randomBytes(12),
      encoder = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    encoder.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([
      encoder.update(payload),
      encoder.final(),
    ]);
    return Buffer.concat([iv, encoder.getAuthTag(), encrypted]);
  }
  open(id: string, value: string): string {
    return this.openBytes(id, Buffer.from(value, "base64")).toString("utf8");
  }
  openBytes(id: string, bytes: Buffer): Buffer {
    invariant(
      bytes.length >= 28,
      "STATE_INPUT_INVALID",
      "Encrypted run input is invalid",
    );
    const decoder = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      bytes.subarray(0, 12),
    );
    decoder.setAAD(Buffer.from(id));
    decoder.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      decoder.update(bytes.subarray(28)),
      decoder.final(),
    ]);
  }
  close() {
    this.key.fill(0);
  }
}
