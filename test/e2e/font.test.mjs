// E2E_DIR, E2E_TARGET, E2E_FONT_FILE, E2E_FONT_NAME: an explicitly owned disposable font.
import assert from "node:assert/strict";
import { test } from "node:test";
import { required, session } from "../support/acceptance.mjs";

test("device font lifecycle", async (t) => {
  const { call, raw } = await session(t);
  const target = required("E2E_TARGET"), local = required("E2E_FONT_FILE"), name = required("E2E_FONT_NAME");
  const font = (operation, extra = {}) => call("device", { action: "font", operation, target, ...extra });
  const info = await font("info", { local });
  assert.equal(info.name, name);
  let attempted = false;
  try {
    attempted = true;
    const installed = await font("install", { local });
    assert.equal(installed.command_confirmed, true);
    assert.equal(installed.runtime_verified, false); // This test does not inspect application text rendering.
  } finally {
    if (attempted) assert.equal((await font("uninstall", { name })).command_confirmed, true);
  }
  const remaining = await call("device", { action: "shell", target, command: "ls /data/local/tmp" });
  assert.ok(!JSON.stringify(remaining).includes("deveco-font-"), "Uploaded font staging must be removed");
  const invalid = await raw("device", { action: "font", operation: "uninstall", target, name: "" });
  assert.equal(invalid.isError, true);
});
