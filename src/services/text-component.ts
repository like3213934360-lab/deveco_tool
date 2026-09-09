import { invariant } from "../core/errors.js";

/** Shared by actual input and read-only doctor; detection never starts an agent. */
export function textComponent(machine: string, version: string) {
  invariant(
    ["aarch64", "arm64", "x86_64"].includes(machine),
    "UI_TEXT_UNSUPPORTED",
    "No verified text component for this device architecture",
  );
  invariant(
    /^\d{1,8}\.\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(version),
    "UI_TEXT_UNSUPPORTED",
    "Cannot identify UiTest protocol",
  );
  const minimum = [6, 0, 2, 2];
  invariant(
    (version
      .split(".")
      .map((part, index) => Number(part) - minimum[index]!)
      .find((part) => part !== 0) ?? 0) >= 0,
    "UI_TEXT_UNSUPPORTED",
    "Modern UiTest 6.0.2.2 or newer is required",
  );
  const unix = machine !== "x86_64";
  return {
    unix,
    asset: unix ? "uitest_agent_v1.2.2.so" : "uitest_agent_v1.1.9.x86_64.so",
    endpoint: unix ? "localabstract:uitest_socket" : "tcp:8012",
  };
}
