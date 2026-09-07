import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { digest } from "../core/files.js";
import { invariant, ToolError } from "../core/errors.js";

const agreementNames = [
  "HarmonyOS_Software_Service_Agreement",
  "HarmonyOS_SDK_Agreement",
] as const;
export interface EmulatorLicenseLocation {
  directory: string;
  config: string;
}
export function emulatorLicenseLocation(
  executable: string,
  version: string,
): EmulatorLicenseLocation {
  const match = /\b(\d+)\.(\d+)\.\d+/.exec(version);
  invariant(
    match,
    "EMULATOR_VERSION_INVALID",
    "Emulator did not declare a component version",
  );
  const cache =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library/Caches")
        : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  invariant(
    cache && path.isAbsolute(cache),
    "EMULATOR_CONFIG_UNAVAILABLE",
    "Cannot locate the native emulator cache",
  );
  return {
    directory: path.join(path.dirname(executable), "agreement"),
    config: path.join(
      cache,
      "Huawei",
      `Emulator${match[1]}.${match[2]}`,
      ".emu_config",
    ),
  };
}

/** Read-only bounded file access: unlike Emulator -license, declining a prompt
 * must never reset an existing acceptance flag. No bundled obsolete agreement. */
async function read(file: string, signal?: AbortSignal): Promise<Buffer> {
  const handle = await fs.promises.open(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    invariant(
      before.isFile() && before.size <= 1024 * 1024,
      "EMULATOR_LICENSE_INVALID",
      "Agreement/config must be a regular file of at most 1 MiB",
    );
    const content = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < content.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(
        content,
        offset,
        content.length - offset,
        offset,
      );
      invariant(
        bytesRead > 0,
        "EMULATOR_LICENSE_CHANGED",
        "Agreement/config changed during reading",
      );
      offset += bytesRead;
    }
    const after = await handle.stat();
    invariant(
      before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      "EMULATOR_LICENSE_CHANGED",
      "Agreement/config changed during reading",
    );
    return content;
  } finally {
    await handle.close();
  }
}

export async function readEmulatorLicenses(
  location: EmulatorLicenseLocation,
  signal?: AbortSignal,
) {
  const agreements = [];
  for (const name of agreementNames) {
    const content = await read(
      path.join(location.directory, name + ".txt"),
      signal,
    ).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new ToolError(
          "EMULATOR_LICENSE_UNAVAILABLE",
          "Installed emulator does not include the current agreement files",
        );
      throw error;
    });
    invariant(
      content.length > 0,
      "EMULATOR_LICENSE_INVALID",
      "Agreement file is empty",
    );
    agreements.push({
      name,
      content,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      bytes: content.length,
    });
  }
  return {
    agreements,
    license_sha256: digest(
      agreements.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
    ),
  };
}

export async function emulatorLicenseStatus(
  location: EmulatorLicenseLocation,
  signal?: AbortSignal,
) {
  let content: string;
  try {
    content = (await read(location.config, signal)).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        accepted: false,
        agreements: agreementNames.map((name) => ({ name, accepted: false })),
      };
    throw error;
  }
  const agreements = agreementNames.map((name) => {
    const values = content
      .split(/\r?\n/)
      .filter((line) => line.startsWith(name + ":"))
      .map((line) => line.slice(name.length + 1).trim());
    invariant(
      values.length <= 1 &&
        values.every((value) => ["agree", "disagree"].includes(value)),
      "EMULATOR_LICENSE_CONFIG_INVALID",
      "Native agreement flags are ambiguous or unsupported",
    );
    return { name, accepted: values[0] === "agree" };
  });
  return { accepted: agreements.every((item) => item.accepted), agreements };
}
