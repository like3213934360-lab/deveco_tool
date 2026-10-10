import fs from "node:fs";
import path from "node:path";
import { invariant, ToolError } from "../core/errors.js";

/** Read only QCOW2 metadata, never the multi-GB RAM payload or any disk contents.
 * Format: https://www.qemu.org/docs/master/interop/qcow2.html#snapshots
 * The Emulator stores Quick Boot VM state as `emu-snapshot-default` in ram.bin.
 */
export function hasBootSnapshot(file: string) {
  if (!fs.existsSync(file)) return false;
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const read = (offset: number, length: number) => {
      invariant(Number.isSafeInteger(offset) && offset >= 0 && offset + length <= size,
        "CAPABILITY_UNAVAILABLE", "Invalid Quick Boot snapshot metadata", { file });
      const data = Buffer.alloc(length);
      invariant(fs.readSync(fd, data, 0, length, offset) === length, "CAPABILITY_UNAVAILABLE", "Truncated Quick Boot snapshot", { file });
      return data;
    };
    const header = read(0, 72);
    invariant(header.readUInt32BE(0) === 0x514649fb && [2, 3].includes(header.readUInt32BE(4)),
      "CAPABILITY_UNAVAILABLE", "Unsupported Quick Boot snapshot format", { file });
    const count = header.readUInt32BE(60);
    invariant(count <= 1024, "CAPABILITY_UNAVAILABLE", "Quick Boot snapshot table exceeds inspection limit", { file });
    let offset = Number(header.readBigUInt64BE(64));
    for (let i = 0; i < count; i++) {
      const row = read(offset, 40), extra = row.readUInt32BE(36), idSize = row.readUInt16BE(12), nameSize = row.readUInt16BE(14);
      const name = read(offset + 40 + extra + idSize, nameSize).toString("utf8");
      const stateSize = extra >= 8 ? read(offset + 40, 8).readBigUInt64BE() : BigInt(row.readUInt32BE(32));
      if (name === "emu-snapshot-default" && stateSize > 0n) return true;
      offset += Math.ceil((40 + extra + idSize + nameSize) / 8) * 8;
    }
    return false;
  } finally { fs.closeSync(fd); }
}

/** Capture the log position BEFORE launch. Historical restores never prove this attempt succeeded. */
export function snapshotBoot(instancePath: string) {
  const snapshot = path.join(instancePath, "ram.bin"), log = path.join(instancePath, "Log/qemu.log");
  invariant(hasBootSnapshot(snapshot), "CAPABILITY_UNAVAILABLE", "No saved Quick Boot snapshot; snapshot start would cold boot instead",
    { snapshot }, "Explicitly coldboot this Quick Boot instance, then stop it to save a snapshot");
  let position = fs.existsSync(log) ? fs.statSync(log) : undefined;
  let offset = position?.size ?? 0, restored = false, carry = "";
  return () => {
    if (!fs.existsSync(log)) return false;
    const fd = fs.openSync(log, "r");
    try {
      const stat = fs.fstatSync(fd);
      if (position?.ino !== stat.ino || stat.size < offset) { offset = 0; carry = ""; restored = false; }
      position = stat;
      // Bounded allocation and work; a noisy or unknown SDK cannot turn missing evidence into success.
      invariant(stat.size - offset <= 4 * 1024 * 1024, "EFFECT_UNCERTAIN", "Snapshot log exceeds inspection budget", { log });
      const bytes = Buffer.alloc(Math.min(65536, stat.size - offset));
      while (offset < stat.size) {
        const count = fs.readSync(fd, bytes, 0, Math.min(bytes.length, stat.size - offset), offset);
        if (!count) break;
        offset += count;
        const text = carry + bytes.subarray(0, count).toString("utf8");
        if (/snapshot .{0,60}failed|could not use snapshot|default snapshot is not exist/i.test(text))
          throw new ToolError("EMULATOR_FAILED", "SDK could not restore the requested snapshot", { log }, "No coldboot/reset retry was issued; inspect the instance before stopping it");
        restored ||= /load port from snapshot: \d+/.test(text);
        carry = text.slice(-256);
      }
      return restored;
    } finally { fs.closeSync(fd); }
  };
}
