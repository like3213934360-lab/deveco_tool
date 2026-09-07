import type { ProcessResult } from "../core/process.js";
import { invariant } from "../core/errors.js";

export function connectedTargets(result: ProcessResult): string[] {
  invariant(
    !result.truncated,
    "DEVICE_INVENTORY_TRUNCATED",
    "Device selection requires the complete HDC inventory",
  );
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "[Empty]"))
    return [];
  invariant(
    lines.length <= 256,
    "DEVICE_INVENTORY_LIMIT",
    "HDC inventory exceeds 256 entries",
  );
  const targets: string[] = [];
  for (const line of lines) {
    const [id, status, extra] = line.split(/\s+/);
    invariant(
      id &&
        id.length <= 512 &&
        /^[^-\s\[\]\0][^\s\[\]\0]*$/.test(id) &&
        extra === undefined &&
        (status === undefined ||
          ["device", "unauthorized", "offline"].includes(status.toLowerCase())),
      "DEVICE_INVENTORY_INVALID",
      "HDC returned an unrecognized inventory row",
    );
    if (!status || status.toLowerCase() === "device") targets.push(id);
  }
  return [...new Set(targets)];
}

const required = [
  "const.product.name",
  "const.product.devicetype",
  "const.product.model",
  "const.product.cpu.abilist",
  "const.ohos.fullname",
  "const.ohos.apiversion",
];
const optional = [
  "const.ohos.releasetype",
  "ohos.qemu.hvd.name",
  "const.build.product",
];
export function deviceProperties(target: string, result: ProcessResult) {
  const properties: Record<string, string> = {};
  const ambiguous = new Set<string>();
  const seen = new Map<string, string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim(),
      value = line.slice(index + 1).trim();
    if (![...required, ...optional].includes(key)) continue;
    if (seen.has(key) && seen.get(key) !== value) ambiguous.add(key);
    seen.set(key, value);
    if (value) properties[key] = value;
  }
  invariant(
    ambiguous.size === 0,
    "DEVICE_PROPERTIES_INVALID",
    "Device returned contradictory values for requested properties",
  );
  const missing = required.filter((key) => !properties[key]);
  const emulatorName = properties["ohos.qemu.hvd.name"],
    api = properties["const.ohos.apiversion"],
    release = properties["const.ohos.releasetype"];
  return {
    target,
    serial: target,
    name:
      emulatorName ||
      properties["const.product.name"] ||
      properties["const.product.model"] ||
      properties["const.build.product"] ||
      null,
    kind:
      emulatorName || target.startsWith("127.0.0.1:") ? "emulator" : "device",
    kind_source: emulatorName
      ? "device_property"
      : "transport_address_heuristic",
    device_type: properties["const.product.devicetype"] ?? null,
    os_version: api ? `API ${api}${release ? ` (${release})` : ""}` : null,
    properties,
    complete: !result.truncated && missing.length === 0,
    missing_properties: missing,
    truncated: result.truncated,
  };
}
