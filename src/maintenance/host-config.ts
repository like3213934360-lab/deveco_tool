import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { invariant, ToolError } from "../core/errors.js";

type HostSpec = {
  host_format: "codex-toml" | "mcp-json";
  server: string;
  node: string;
  installation: string;
  state_dir: string;
};
const record = z.record(z.string(), z.unknown());
function document(original: string, format: HostSpec["host_format"]) {
  try {
    return record.parse(format === "mcp-json" ? JSON.parse(original) as unknown : parse(original, { integersAsBigInt: true }));
  } catch {
    throw new ToolError("UPGRADE_HOST_UNSUPPORTED", "Host configuration cannot be parsed without losing settings; no configuration was changed");
  }
}
function selected(config: Record<string, unknown>, spec: HostSpec) {
  const key = spec.host_format === "mcp-json" ? "mcpServers" : "mcp_servers";
  const servers = record.parse(config[key]);
  invariant(Object.hasOwn(servers, spec.server), "UPGRADE_SERVER_MISSING", "Selected MCP entry is missing");
  return { key, servers, entry: record.parse(servers[spec.server]) };
}
export function previousHost(original: string, spec: HostSpec) {
  const { entry } = selected(document(original, spec.host_format), spec);
  const args = z.array(z.string()).min(1).parse(entry.args);
  const env = entry.env === undefined ? {} : z.record(z.string(), z.string()).parse(entry.env);
  return { entry: args[0]!, state_dir: env.DEVECO_STATE_DIR, configuration_file: env.DEVECO_CONFIG };
}

/** Change only the selected launch command and the two owned environment keys. */
export function patchHost(original: string, spec: HostSpec): string {
  const config = document(original, spec.host_format);
  const { key, servers, entry } = selected(config, spec);
  const env = entry.env === undefined ? {} : z.record(z.string(), z.string()).parse(entry.env);
  servers[spec.server] = {
    ...entry,
    command: spec.node,
    args: [path.join(spec.installation, "dist/src/cli.js")],
    env: { ...env, DEVECO_CONFIG: path.join(spec.state_dir, "configuration.json"), DEVECO_STATE_DIR: spec.state_dir },
  };
  config[key] = servers;
  let result: string;
  try { result = spec.host_format === "mcp-json" ? JSON.stringify(config, null, 2) + "\n" : stringify(config, { numbersAsFloat: true }); }
  catch { throw new ToolError("UPGRADE_HOST_UNSUPPORTED", "Host settings could not be serialized losslessly"); }
  invariant(isDeepStrictEqual(document(result, spec.host_format), config), "UPGRADE_HOST_UNSUPPORTED", "Host settings did not survive serialization; no configuration was changed");
  return result;
}
