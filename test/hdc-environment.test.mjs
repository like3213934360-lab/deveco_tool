import test from "node:test";
import assert from "node:assert/strict";
import { createHdcEnvironmentResolver } from "../src/hdc-environment.mjs";

test("macOS minimal environments recover user temp once without changing explicit configuration", () => {
  let calls = 0;
  const resolve = createHdcEnvironmentResolver({ platform: "darwin", resolveTemp: () => { calls++; return "/user/temp/"; } });
  const input = { PATH: "/bin" };
  assert.deepEqual(resolve(input), { PATH: "/bin", TMPDIR: "/user/temp/" });
  assert.equal(input.TMPDIR, undefined);
  assert.equal(resolve({}).TMPDIR, "/user/temp/");
  assert.equal(calls, 1);
  const explicit = { TMPDIR: "/chosen/" };
  assert.equal(resolve(explicit), explicit);
});

test("non-macOS and unavailable discovery retain the caller environment", () => {
  for (const platform of ["linux", "win32"]) {
    const resolve = createHdcEnvironmentResolver({ platform, resolveTemp: () => { throw new Error("must not probe"); } });
    const input = { TEMP: "chosen" };
    assert.equal(resolve(input), input);
  }
  let calls = 0;
  const resolve = createHdcEnvironmentResolver({ platform: "darwin", resolveTemp: () => { calls++; throw new Error("unavailable"); } });
  const input = {};
  assert.equal(resolve(input), input);
  assert.equal(resolve(input), input);
  assert.equal(calls, 1);
});
