import { kvDelete, kvGet, kvSet } from "../core/db.js";
import { invariant, errorResult, ToolError } from "../core/errors.js";
import { checkedCommand, shellValue } from "./device-controls.js";

interface Claim { id?: number; custom?: string }
interface NetworkInput {
  operation?: string; scenario_id?: number; name?: string;
  up_bandwidth?: number; down_bandwidth?: number; up_latency?: number; down_latency?: number; up_drop?: number; down_drop?: number;
}

export function parseNetworkState(output: string) {
  const scenarios: { id: number; name: string; active: boolean }[] = [];
  if (/^get active scenario failed, make sure netcopilot is enabled$/i.test(output.trim())) return { enabled: false, scenarios, active_id: null };
  invariant(/^\s*\|\s*ScenarioID\s*\|\s*ScenarioName\s*\|\s*$/m.test(output), "DEVICE_OUTPUT_INVALID", "Unrecognized netcopilot status", { output: output.slice(0, 500) });
  for (const line of output.split(/\r?\n/)) {
    const row = /^\s*(?:(\d+)|\[(\d+)\])\s*\|\s*(.+?)\s*$/.exec(line);
    if (!row) continue;
    const id = Number(row[1] ?? row[2]);
    invariant(Number.isSafeInteger(id) && !scenarios.some((item) => item.id === id), "DEVICE_OUTPUT_INVALID", "Invalid or repeated netcopilot scenario ID");
    scenarios.push({ id, name: row[3]!, active: row[2] !== undefined });
  }
  const active = scenarios.filter(({ active }) => active);
  invariant(scenarios.length > 0 && active.length <= 1, "DEVICE_OUTPUT_INVALID", "Netcopilot returned an incomplete or ambiguous scenario table");
  return { enabled: true, scenarios, active_id: active[0]?.id ?? null };
}

const net = (target: string, args: string[], signal: AbortSignal) => checkedCommand(target, ["netcopilot", ...args], signal);
const state = async (target: string, signal: AbortSignal) => parseNetworkState(await net(target, ["-p"], signal));

async function confirmed(target: string, args: string[], signal: AbortSignal) {
  const output = await net(target, args, signal);
  invariant(/\bsuccess(?:ful(?:ly)?)?\b/i.test(output), "DEVICE_OUTPUT_INVALID", "Netcopilot did not confirm the operation", { output: output.slice(0, 500) });
}

async function stopOwned(target: string, key: string, claim: Claim, signal: AbortSignal) {
  let before = await state(target, signal);
  if (!before.enabled && claim.custom) {
    // Custom scenarios persist across disable. The caller explicitly asked to remove ours.
    await confirmed(target, ["-e", "1"], signal);
    before = await state(target, signal);
  }
  const custom = claim.custom ? before.scenarios.filter((item) => item.id >= 1000 && item.name === claim.custom) : [];
  invariant(custom.length < 2 && (!custom.length || claim.id === undefined || custom[0]!.id === claim.id), "CONFLICT", "Owned custom scenario identity changed");
  invariant(before.active_id === null || before.active_id === (claim.id ?? custom[0]?.id), "CONFLICT", "Another scenario is active; preserve the external simulation", { active_id: before.active_id });
  if (before.enabled) {
    if (before.active_id !== null) await confirmed(target, ["-c"], signal);
    if (custom.length) await confirmed(target, ["-d", String(custom[0]!.id)], signal);
    const cleared = await state(target, signal);
    invariant(cleared.active_id === null && !cleared.scenarios.some((item) => item.id >= 1000 && item.name === claim.custom), "EFFECT_UNCERTAIN", "Netcopilot did not verify removal of the owned scenario");
    await confirmed(target, ["-e", "0"], signal);
  }
  const after = await state(target, signal);
  invariant(!after.enabled, "EFFECT_UNCERTAIN", "Netcopilot still appears enabled");
  await kvDelete(key);
  return { target, enabled: false, stopped: true };
}

export async function networkSimulation(target: string, input: NetworkInput, signal: AbortSignal) {
  const { operation, scenario_id, name, up_bandwidth, down_bandwidth, up_latency, down_latency, up_drop, down_drop } = input;
  invariant(operation === "list" || operation === "status" || operation === "start" || operation === "stop", "INVALID_INPUT", "Unknown network_sim operation");
  if (operation === "start") {
    const custom = [name, up_bandwidth, down_bandwidth, up_latency, down_latency, up_drop, down_drop];
    invariant(scenario_id === undefined ? custom.every((value) => value !== undefined) && name && name.length <= 64 && name.trim() === name && !/[|\r\n\0]/.test(name)
      : custom.every((value) => value === undefined), "INVALID_INPUT", "Pass either scenario_id or name with all six network limits");
  }
  const key = `netcopilot:${target}`, receipt = await kvGet(key);
  const claim = receipt ? JSON.parse(receipt) as Claim : undefined;
  const before = await state(target, signal);
  if (operation === "list" || operation === "status") return { target, ...before, managed: !!claim };
  if (operation === "stop") {
    if (claim) return stopOwned(target, key, claim, signal);
    invariant(!before.enabled, "CONFLICT", "Netcopilot was started outside this MCP; preserve its settings");
    return { target, enabled: false, stopped: true };
  }
  invariant(!before.enabled && !claim, "CONFLICT", "An existing network simulation or recovery receipt must be resolved first", { managed: !!claim });
  const owned: Claim = { id: scenario_id };
  const attempt = AbortSignal.any([signal, AbortSignal.timeout(28000)]);
  await kvSet(key, JSON.stringify(owned));
  try {
    await confirmed(target, ["-e", "1"], attempt);
    if (name !== undefined) {
      const current = await state(target, attempt);
      invariant(!current.scenarios.some((item) => item.name === name), "CONFLICT", "A network scenario with this name already exists");
      owned.custom = name;
      await kvSet(key, JSON.stringify(owned));
      const payload = { scenarioName: name, uplinkBandwidth: up_bandwidth, downlinkBandwidth: down_bandwidth, uplinkLatency: up_latency, downlinkLatency: down_latency, uplinkDropRate: up_drop, downlinkDropRate: down_drop };
      await confirmed(target, ["-a", shellValue(JSON.stringify(payload))], attempt);
      const added = (await state(target, attempt)).scenarios.filter((item) => item.id >= 1000 && item.name === name);
      invariant(added.length === 1, "EFFECT_UNCERTAIN", "Cannot identify the newly created custom scenario");
      owned.id = added[0]!.id;
      await kvSet(key, JSON.stringify(owned));
    }
    await net(target, ["-s", String(owned.id)], attempt);
    const active = await state(target, attempt);
    invariant(active.enabled && active.active_id === owned.id, "EFFECT_UNCERTAIN", "Netcopilot did not report the requested active scenario", { expected: owned.id, actual: active.active_id });
    return { target, enabled: true, active_id: owned.id, managed: true, traffic_verified: false };
  } catch (error) {
    try { await stopOwned(target, key, owned, AbortSignal.timeout(18000)); }
    catch (cleanup) { throw new ToolError("DEVICE_CLEANUP_FAILED", "Network simulation failed and requires explicit stop", { original: errorResult(error), cleanup: errorResult(cleanup) }); }
    throw error;
  }
}
