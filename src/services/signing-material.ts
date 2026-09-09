import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWrite } from "../core/files.js";
import { invariant } from "../core/errors.js";

/** Emit the modern Hvigor AES-GCM material layout, with a fresh key per directory.
 * Its filesystem permissions protect the secret; material and ciphertext together
 * can be decrypted by Studio and are not a remote secret store. */
export function createSigningMaterial(
  directory: string,
  passwords: { keystorePwd: string; keyPwd: string },
) {
  fs.mkdirSync(directory, { mode: 0o700 });
  const parts = Array.from({ length: 3 }, () => crypto.randomBytes(16)),
    salt = crypto.randomBytes(32),
    work = crypto.randomBytes(16),
    merged = Buffer.from([
      49, 243, 9, 115, 214, 175, 91, 184, 211, 190, 177, 88, 101, 131, 192, 119,
    ]);
  let root: Buffer | undefined;
  const encrypt = (key: Buffer, plain: Buffer) => {
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv("aes-128-gcm", key, iv),
      encrypted = Buffer.concat([
        cipher.update(plain),
        cipher.final(),
        cipher.getAuthTag(),
      ]),
      length = Buffer.alloc(4);
    length.writeUInt32BE(encrypted.length);
    return Buffer.concat([length, iv, encrypted]);
  };
  const write = (component: string, bytes: Buffer) =>
    atomicWrite(path.join(directory, component, "data"), bytes, false);
  try {
    for (const [index, part] of parts.entries()) {
      for (let i = 0; i < 16; i++) merged[i] = merged[i]! ^ part[i]!;
      write(`fd/${index}`, part);
    }
    root = crypto.pbkdf2Sync(merged.toString(), salt, 10000, 16, "sha256");
    write("ac", salt);
    write("ce", encrypt(root, work));
    const protect = (password: string) => {
      const bytes = Buffer.from(password);
      try {
        return encrypt(work, bytes).toString("hex");
      } finally {
        bytes.fill(0);
      }
    };
    return {
      storePassword: protect(passwords.keystorePwd),
      keyPassword: protect(passwords.keyPwd),
    };
  } finally {
    for (const part of parts) part.fill(0);
    merged.fill(0);
    root?.fill(0);
    work.fill(0);
  }
}

/** Modern Studio/Hvigor material protocol, derived from Huawei's MIT implementation. */
export function decryptMaterial(
  directory: string,
  encryptedHex: string,
): string {
  const read = (file: string): Buffer => {
    if (!fs.statSync(file).isDirectory()) return fs.readFileSync(file);
    const children = fs
      .readdirSync(file)
      .filter((name) => name !== ".DS_Store");
    invariant(
      children.length === 1 && children[0],
      "MATERIAL_INVALID",
      "Expected one material component",
    );
    return read(path.join(file, children[0]));
  };
  const decrypt = (key: Buffer, data: Buffer) => {
    invariant(
      data.length >= 32,
      "MATERIAL_INVALID",
      "Encrypted material is too short",
    );
    const length = data.readUInt32BE(0),
      ivLength = data.length - 4 - length;
    invariant(
      ivLength === 12 && length >= 16,
      "MATERIAL_INVALID",
      "Unsupported material frame",
    );
    const cipher = crypto.createDecipheriv(
      "aes-128-gcm",
      key,
      data.subarray(4, 16),
    );
    cipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([
      cipher.update(data.subarray(16, -16)),
      cipher.final(),
    ]);
  };
  const fd = path.join(directory, "fd"),
    entries = fs.readdirSync(fd).filter((name) => name !== ".DS_Store");
  invariant(
    entries.length === 3,
    "MATERIAL_INVALID",
    "Expected three key components",
  );
  const components = entries.map((name) => read(path.join(fd, name)));
  invariant(
    components.every((item) => item.length === 16),
    "MATERIAL_INVALID",
    "Invalid key component size",
  );
  const merged = Buffer.from([
    49, 243, 9, 115, 214, 175, 91, 184, 211, 190, 177, 88, 101, 131, 192, 119,
  ]);
  for (const part of components)
    for (let i = 0; i < 16; i++) merged[i] = merged[i]! ^ part[i]!;
  const root = crypto.pbkdf2Sync(
    merged.toString(),
    read(path.join(directory, "ac")),
    10000,
    16,
    "sha256",
  );
  const work = decrypt(root, read(path.join(directory, "ce")));
  try {
    return decrypt(work, Buffer.from(encryptedHex, "hex")).toString("utf8");
  } finally {
    merged.fill(0);
    root.fill(0);
    work.fill(0);
  }
}
