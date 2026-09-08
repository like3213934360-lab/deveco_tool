import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { invariant } from "../core/errors.js";

export const emulatorBindingSchema = z.object({ name: z.string(), instance: z.string(), uuid: z.string(), target: z.string(), port: z.number().int().positive().max(65535) });
export type EmulatorBinding = z.infer<typeof emulatorBindingSchema>;

/** Bind a configured endpoint, or verify the live guest's native instance name
 * when the SDK leaves its port unset. Never infer identity from device count. */
export async function emulatorBinding(name: string, instancePath: string | undefined, target: string, guestName?: () => Promise<string>): Promise<EmulatorBinding> {
  invariant(instancePath && path.isAbsolute(instancePath), "EMULATOR_IDENTITY_UNAVAILABLE", "Native inventory did not declare an absolute instancePath");
  const instance = await fs.promises.realpath(instancePath), file = path.join(instance, "config.ini"), stat = await fs.promises.lstat(file);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, "EMULATOR_IDENTITY_INVALID", "Native instance configuration must be a regular file of at most 64 KiB");
  const content = await fs.promises.readFile(file, "utf8"), values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(name|uuid|instancePath|hw\.hdc\.port)\s*=(.*?)\s*$/.exec(line);
    if (!match) continue;
    invariant(!values.has(match[1]!), "EMULATOR_IDENTITY_INVALID", "Native instance identity contains duplicate fields");
    values.set(match[1]!, match[2]!);
  }
  let port = Number(values.get("hw.hdc.port"));
  const uuid = values.get("uuid");
  if (values.get("hw.hdc.port") === "notset" && guestName) {
    const endpoint = /^(?:127\.0\.0\.1|localhost|\[::1\]):([1-9][0-9]{0,4})$/.exec(target);
    invariant(endpoint && Number(endpoint[1]) <= 65535, "EMULATOR_TARGET_MISMATCH", "An unset emulator port requires a loopback HDC endpoint");
    invariant(await guestName() === name, "EMULATOR_TARGET_MISMATCH", "The connected guest does not identify the selected native instance");
    port = Number(endpoint[1]);
  }
  const after = await fs.promises.lstat(file);
  invariant(after.ino === stat.ino && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs, "EMULATOR_IDENTITY_CHANGED", "Native instance configuration changed during capture");
  invariant(values.get("name") === name && uuid && values.get("instancePath") && await fs.promises.realpath(values.get("instancePath")!) === instance, "EMULATOR_IDENTITY_INVALID", "Native inventory and instance configuration disagree");
  invariant(Number.isInteger(port) && port > 0 && port <= 65535, "EMULATOR_TARGET_UNAVAILABLE", "Running instance has no declared HDC port; refresh native inventory before selecting a device");
  invariant(target === `127.0.0.1:${port}` || target === `localhost:${port}` || target === `[::1]:${port}`, "EMULATOR_TARGET_MISMATCH", `Selected HDC endpoint does not belong to ${name}; expected loopback port ${port}`);
  return { name, instance, uuid, target, port };
}
