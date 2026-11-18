import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { temporaryDirectory } from "../support/workspace.mjs";

const work = temporaryDirectory("displays"), bundle = path.join(work, "displays.mjs");
after(() => fs.rmSync(work, { recursive: true, force: true }));
await build({ entryPoints: ["src/domains/displays.ts"], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external" });
const { parseDisplays } = await import(pathToFileURL(bundle).href);

const dump = `
---------------- Screen ID: 7 ----------------
[SCREEN SESSION]
DisplayId: 2
Rotation: 3
[SCREEN PROPERTY]
Rotation: 270
RefreshRate: 60
---------------- Screen ID: 8 ----------------
[SCREEN SESSION]
DisplayId: 9
[SCREEN PROPERTY]
Rotation: 0
---------------- Display ID: 2 ----------------
[DISPLAY INFO]
Height: 1080
Width: 1920
---------------- Display ID: 9 ----------------
[DISPLAY INFO]
Width: 1280
Height: 720
------------- Client Screen Infos -------------
ScreenId: 8
Rotation: 90
RefreshRate: 120
VirtualPixelRatio: 1.5
ScreenId: 7
VirtualPixelRatio: 2.0
-----------------------------------------------
`;

test("display and screen IDs associate the size and metadata even when dump order differs", () => {
  assert.deepEqual(parseDisplays(dump.replaceAll("\n", "\r\n")), [
    { id: 2, width: 1920, height: 1080, screen_id: 7, refresh_rate: 60, vpr: 2, rotation: 270 },
    { id: 9, width: 1280, height: 720, screen_id: 8, refresh_rate: 120, vpr: 1.5, rotation: 90 },
  ]);
});

test("a malformed display never yields a partial inventory or borrows a neighboring height", () => {
  assert.throws(() => parseDisplays(dump.replace("Height: 1080", "")), { code: "DEVICE_OUTPUT_INVALID" });
  assert.throws(() => parseDisplays(dump.replace("Display ID: 9", "Display ID: 2")), { code: "DEVICE_OUTPUT_INVALID" });
  assert.deepEqual(parseDisplays("[DISPLAY INFO]\nWidth: 1080\nHeight: 1920\n"), [
    { id: 0, width: 1080, height: 1920, screen_id: null, refresh_rate: null, vpr: null, rotation: null },
  ]);
});
