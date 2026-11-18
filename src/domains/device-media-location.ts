import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invariant, errorResult, ToolError } from "../core/errors.js";
import { checkedCommand, shellValue } from "./device-controls.js";
import { sendFile } from "./device.js";

const playbackBin = "/system/bin/cli_tool/executable/ohos-avsession-manager";
const commands = { play: "play", pause: "pause", next: "play_next", previous: "play_previous", forward: "fast_forward", rewind: "rewind", seek: "seek" } as const;

async function mediaCommand(target: string, args: string[], signal: AbortSignal) {
  const output = await checkedCommand(target, [playbackBin, ...args], signal);
  let data: { status?: unknown; data?: { sessions?: unknown }; errMsg?: string; suggestion?: string };
  try { data = JSON.parse(output); }
  catch { throw new ToolError("DEVICE_OUTPUT_INVALID", "Media session command did not return JSON", { output: output.slice(0, 500) }); }
  invariant(data?.status === "success", "DEVICE_COMMAND_FAILED", "Media session command failed", { error: data?.errMsg, suggestion: data?.suggestion });
  return data.data;
}

export function mediaSessions(sessions: unknown) {
  invariant(Array.isArray(sessions), "DEVICE_OUTPUT_INVALID", "Media service returned no session list");
  const ids = new Set<string>();
  return sessions.map((session) => {
    const id = session?.sessionId, bundle = session?.elementName?.bundleName;
    invariant(typeof id === "string" && id && !ids.has(id) && typeof bundle === "string" && bundle,
      "DEVICE_OUTPUT_INVALID", "Media service returned an invalid or duplicate session");
    ids.add(id);
    return { id, bundle };
  });
}

export async function playback(target: string, input: { operation?: string; session_id?: string; bundle?: string; position_seconds?: number }, signal: AbortSignal) {
  const operation = input.operation as keyof typeof commands;
  invariant(input.operation === "list" || Object.hasOwn(commands, operation), "INVALID_INPUT", "Unknown playback operation");
  if (input.operation !== "list") {
    invariant(input.session_id || input.bundle, "INVALID_INPUT", "Playback control needs session_id or bundle");
    invariant(operation !== "seek" || input.position_seconds !== undefined, "INVALID_INPUT", "Playback seek needs position_seconds");
  }
  const sessions = mediaSessions((await mediaCommand(target, ["list-sessions"], signal))?.sessions);
  if (input.operation === "list") return { target, sessions };
  const matches = sessions.filter((session) => (!input.session_id || session.id === input.session_id) && (!input.bundle || session.bundle === input.bundle));
  invariant(matches.length === 1, matches.length ? "INVALID_INPUT" : "NOT_FOUND", "Select a unique media session", { matches });
  const session = matches[0]!;
  await mediaCommand(target, ["send-control-command-to-session", "--session-id", shellValue(session.id), "--command", commands[operation],
    ...(operation === "seek" ? ["--time", String(Math.round(input.position_seconds! * 1000))] : [])], signal);
  return { target, operation, session, command_confirmed: true, runtime_verified: false };
}

interface LocationInput { operation?: string; local?: string; latitude?: number; longitude?: number; altitude?: number; speed?: number; bearing?: number; interval?: number }

async function locationCommand(target: string, operation: string, args: string[], signal: AbortSignal) {
  const output = await checkedCommand(target, ["testhelper", operation, ...args], signal);
  invariant(/\bsuccess(?:ful(?:ly)?)?\b/i.test(output), "DEVICE_OUTPUT_INVALID", "Location test helper did not confirm the command", { output: output.slice(0, 500) });
  return output;
}

export async function locationMock(target: string, input: LocationInput, signal: AbortSignal) {
  const operation = input.operation;
  invariant(operation === "enable" || operation === "disable" || operation === "set", "INVALID_INPUT", "Unknown location operation");
  if (operation !== "set") {
    const output = await locationCommand(target, `${operation}-location-mock`, [], signal);
    return { target, operation, command_confirmed: true, runtime_verified: false, output };
  }
  const coordinateOptions = [input.latitude, input.longitude, input.altitude, input.speed, input.bearing];
  invariant(input.local ? coordinateOptions.every((n) => n === undefined) : input.latitude !== undefined && input.longitude !== undefined,
    "INVALID_INPUT", "Location set needs either a local GPX file or latitude and longitude");
  let gpx: string;
  if (input.local) {
    invariant(path.isAbsolute(input.local) && path.extname(input.local).toLowerCase() === ".gpx", "INVALID_INPUT", "local must be an absolute .gpx file path");
    const stat = fs.statSync(input.local, { throwIfNoEntry: false });
    invariant(stat?.isFile() && stat.size > 0 && stat.size <= 4 * 1024 * 1024, "INVALID_INPUT", "GPX must be a non-empty file of at most 4 MiB");
    gpx = fs.readFileSync(input.local, "utf8");
    invariant(/<gpx\b[^>]*\bversion\s*=\s*['"]1\.1['"]/i.test(gpx) && !/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(gpx), "INVALID_INPUT", "Expected GPX 1.1 without a DTD");
  } else {
    const tags = Object.entries({ ele: input.altitude, speed: input.speed, direction: input.bearing }).flatMap(([tag, value]) => value === undefined ? [] : [`<${tag}>${value}</${tag}>`]);
    gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="deveco-mcp" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="${input.latitude}" lon="${input.longitude}">${tags.join("")}</wpt></gpx>\n`;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-gpx-"));
  const local = path.join(directory, "location.gpx"), remote = `/data/local/tmp/deveco-gpx-${crypto.randomUUID()}.gpx`;
  let sendStarted = false, enableStarted = false, failure: unknown;
  const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(35000)]);
  try {
    fs.writeFileSync(local, gpx, { flag: "wx", mode: 0o600 });
    sendStarted = true;
    await sendFile(target, local, remote, operationSignal);
    enableStarted = true;
    await locationCommand(target, "enable-location-mock", [], operationSignal);
    const output = await locationCommand(target, "set-mocked-locations", [remote, ...(input.interval === undefined ? [] : [String(input.interval)])], operationSignal);
    return { target, operation, command_confirmed: true, runtime_verified: false, scope: "debug-signed applications", output };
  } catch (error) {
    failure = error;
    if (enableStarted && error instanceof ToolError) throw new ToolError(error.code, error.message, { ...error.details, mock_may_be_enabled: true }, "Call device location disable to restore real location");
    throw error;
  } finally {
    try { if (sendStarted) await checkedCommand(target, ["rm", "-f", remote], AbortSignal.timeout(10000)); }
    catch (error) { throw new ToolError("DEVICE_CLEANUP_FAILED", "Uploaded GPX cleanup failed", { remote, cause: errorResult(error), ...(failure ? { original: errorResult(failure) } : {}) }); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}
