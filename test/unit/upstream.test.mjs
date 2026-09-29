// The alignment gate is only trustworthy if extraction is exhaustive: pin every construct it must see.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extract } from "../../tools/upstream/extract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = path.join(root, "test/fixtures/upstream");

test("extracts every commander / zod / effect-schema construct from upstream-shaped sources", () => {
  const items = new Set(extract({ code: path.join(fixtures, "code"), cli: path.join(fixtures, "cli") }));
  const expected = [
    // commander: addCommand of a sibling variable, factory option with choices, flag options
    "cli:cmd:emulator image download", "cli:cmd:emulator image download:opt:--device-type",
    "cli:cmd:emulator image download:choice:--device-type=tablet", "cli:cmd:emulator image download:opt:--force",
    // addOption(new Option) + addArgument(new Argument().choices)
    "cli:cmd:emulator rotate:opt:--target", "cli:cmd:emulator rotate:arg:direction", "cli:cmd:emulator rotate:choice:direction=right",
    // args in .command('x [names...]'), spread option constants, choices from a const array
    "cli:cmd:emulator start:arg:names", "cli:cmd:emulator start:opt:--device", "cli:cmd:emulator start:choice:--mode=slow",
    // `const x = parent.command('y')` alias, then `x.command('z')`
    "cli:cmd:emulator team list", "cli:cmd:emulator team list:opt:--all",
    // exported command added by name + inline addCommand(new Command(...))
    "cli:cmd:ui tap:opt:--id", "cli:cmd:ui tap:arg:x", "cli:cmd:ui shot:opt:--display",
    // bundled MCP server: array-driven registration sharing a schema variable, multi-line zod enum
    "climcp:tool:hover:param:line", "climcp:tool:definition:param:file",
    "climcp:tool:restart:enum:target=cpp", "climcp:tool:restart:param:force",
    // deveco-code: identifier tool id, Literals from a const array and inline array, multi-line fields
    "code:tool:demo_tool", "code:tool:demo_tool:enum:operation=incomingCalls", "code:tool:demo_tool:enum:mode=b",
    "code:tool:demo_tool:param:filePath",
    "code:skill:demo-skill",
  ];
  for (const e of expected) assert.ok(items.has(e), `missing ${e}`);
  // No enum values leak across parameters.
  assert.ok(!items.has("code:tool:demo_tool:enum:filePath=a"));
  assert.ok(!items.has("climcp:tool:restart:enum:force=all"));
});

test("every decision rule and item is well-formed", () => {
  const d = JSON.parse(fs.readFileSync(path.join(root, "tools/upstream/decisions.json"), "utf8"));
  for (const [id, x] of [...Object.entries(d.items), ...d.rules.map((r) => [r.match, r])]) {
    assert.ok(["full", "host", "skip"].includes(x.status), `${id}: bad status`);
    if (x.status === "full") assert.ok(x.to, `${id}: full needs a target`);
    else assert.ok(x.reason, `${id}: ${x.status} needs a reason`);
  }
});
