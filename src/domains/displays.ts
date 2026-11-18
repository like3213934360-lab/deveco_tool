import { invariant } from "../core/errors.js";
import { clip } from "../core/files.js";
import { shell } from "./device.js";

function value(body: string, name: string) {
  const raw = new RegExp(`^ *${name}:[ \\t]*(\\d+(?:\\.\\d+)?)[ \\t]*$`, "m").exec(body)?.[1];
  return raw === undefined ? undefined : Number(raw);
}

export function parseDisplays(raw: string) {
  const dump = raw.replaceAll("\r", "");
  const headers = [...dump.matchAll(/^ *-+ (Screen|Display) ID: (\d+) -+ *$/gm)];
  const sections = headers.map((match, i) => ({ kind: match[1], id: Number(match[2]), body: dump.slice(match.index + match[0].length, headers[i + 1]?.index) }));
  const screens = new Map<number, { id: number; body: string }>();
  for (const screen of sections.filter((s) => s.kind === "Screen")) {
    const displayId = value(screen.body, "DisplayId");
    if (displayId !== undefined && !screens.has(displayId)) screens.set(displayId, screen);
  }
  const clients = new Map<number, string>();
  for (const block of dump.matchAll(/^ *-+ Client Screen Infos -+ *\n([\s\S]*?)(?=^ *-{3,}|(?![\s\S]))/gm)) {
    const body = block[1]!;
    const ids = [...body.matchAll(/^ *ScreenId:[ \t]*(\d+)[ \t]*$/gm)];
    for (const [i, id] of ids.entries()) clients.set(Number(id[1]), body.slice(id.index, ids[i + 1]?.index));
  }
  const displays = sections.filter((s) => s.kind === "Display");
  // Older SDK dumps expose a single primary display without a numbered section.
  if (!displays.length && !headers.length && dump.split("[DISPLAY INFO]").length === 2) displays.push({ kind: "Display", id: 0, body: dump });
  const seen = new Set<number>();
  return displays.map(({ id, body }) => {
    const info = body.split("[DISPLAY INFO]")[1]?.split(/^ *(?:\[|-{3,})/m)[0] ?? "";
    const width = value(info, "Width"), height = value(info, "Height");
    invariant(Number.isSafeInteger(id) && !seen.has(id) && Number.isSafeInteger(width) && width! > 0 && Number.isSafeInteger(height) && height! > 0,
      "DEVICE_OUTPUT_INVALID", "DisplayManagerService returned an incomplete or duplicate display", { id });
    seen.add(id);
    const screen = screens.get(id);
    const screenId = screen?.id ?? (displays.length === 1 && clients.size === 1 ? clients.keys().next().value : undefined);
    const client = screenId === undefined ? "" : clients.get(screenId) ?? "";
    const properties = screen?.body.split("[SCREEN PROPERTY]")[1] ?? "";
    const rotation = value(client, "Rotation") ?? value(properties, "Rotation");
    return { id, width: width!, height: height!, screen_id: screenId ?? null,
      refresh_rate: value(client, "RefreshRate") ?? value(properties, "RefreshRate") ?? null,
      vpr: value(client, "VirtualPixelRatio") ?? value(screen?.body ?? "", "VirtualPixelRatio") ?? null,
      rotation: rotation !== undefined && [0, 90, 180, 270].includes(rotation) ? rotation : null };
  });
}

export async function listDisplays(target: string, all: boolean, signal: AbortSignal) {
  const result = await shell(target, ["hidumper", "-s", "DisplayManagerService", "-a", "-a"], signal, 10000);
  invariant(result.code === 0 && !result.truncated, "DEVICE_OUTPUT_INVALID", "DisplayManagerService query failed or was truncated", { output: clip(result.stderr || result.stdout, 300) });
  const displays = parseDisplays(result.stdout);
  invariant(displays.length, "DEVICE_OUTPUT_INVALID", "DisplayManagerService returned no display information");
  return { target, displays: all ? displays : displays.map(({ id, width, height }) => ({ id, width, height })) };
}
