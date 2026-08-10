/**
 * @file Pins the device behaviours this pack's correctness is built on. Opt-in, needs a device.
 *
 * Everything in `unified.test.mjs` drives a fake hdc, which is what lets it run on CI. That leaves
 * a gap: a dozen decisions in `src/device-*.mjs` encode how hdc, uitest and snapshot_display
 * actually behave -- how arguments are quoted on the way to the device shell, which strings mean
 * success, what losing the device to another client looks like. Those were established by
 * measurement and then written into comments, where an SDK upgrade can invalidate them silently.
 *
 * Run with a device attached:
 *
 *   DEVECO_CANARY_DEVICE=1 npm run test:device
 *
 * Set it to a specific connect key to pick one of several devices. A failure here is not
 * necessarily a bug in this pack: it means the platform changed under an assumption, and the
 * comment that records the measurement needs revisiting alongside the code.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveHdcPath } from "../src/config.mjs";
import { readTar } from "../src/device-tar.mjs";

const REQUEST = process.env.DEVECO_CANARY_DEVICE;
const HDC = resolveHdcPath();

function connectedDevices() {
  const result = spawnSync(HDC, ["list", "targets"], { encoding: "utf8" });
  return `${result.stdout ?? ""}`.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("[Empty]"));
}

const devices = REQUEST ? connectedDevices() : [];
const device = REQUEST && REQUEST !== "1" ? REQUEST : devices[0];
const skip = !REQUEST
  ? "set DEVECO_CANARY_DEVICE=1 (or to a connect key) to run the device canary"
  : (!device ? "no HarmonyOS device is connected" : false);

/** One `hdc shell` call built exactly the way the source builds it: argv, never a joined string. */
function shell(...args) {
  const result = spawnSync(HDC, ["-t", device, "shell", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(/\r?\n$/, "");
}

function quoteForDevice(text) {
  return `'${text.split("'").join("'\\''")}'`;
}

const SCRATCH = "/data/local/tmp/deveco_canary";

test("hdc passes a whitespace-free argument through untouched", { skip }, () => {
  // This is the whole basis of deviceTextArgument: with no whitespace, our single quotes are
  // unquoted exactly once by the device shell and everything inside arrives literally. If this
  // ever stops holding, text with a backtick starts executing on the device again.
  for (const text of ["`id`", "$HOME", "~/x", "a(b)c", "a;id", "a|b", 'a"b', "a?b", "*", "it's", "你好，世界。"]) {
    assert.equal(shell("echo", quoteForDevice(text)), text, `must arrive literally: ${text}`);
  }
});

test("hdc re-quotes a whitespace-bearing argument, and four characters survive that", { skip }, () => {
  // The other regime. hdc wraps the argument in double quotes of its own, which neutralises globs,
  // parentheses, # and ;, but not these -- which is exactly the set deviceTextArgument refuses.
  for (const inert of ["a(b)c d", "a?b c", "~/x y", "a #b", "a[0-9]b c", "it's fine", "100% off", "a; id"]) {
    assert.equal(shell("echo", inert), inert, `must be inert with whitespace: ${inert}`);
  }
  assert.notEqual(shell("echo", "$HOME y"), "$HOME y", "$ still expands inside hdc's quoting");
  assert.match(shell("echo", "`id` x"), /uid=/, "a backtick still executes inside hdc's quoting");
  assert.notEqual(shell("echo", 'a" ; id ; "b'), 'a" ; id ; "b', "a double quote still closes the wrapper");
});

test("globs expand on the device when something matches", { skip }, () => {
  // The reason `?` and `[` cannot simply be allowed through unquoted: they are only inert when the
  // shell's working directory happens to hold no match.
  shell("mkdir", "-p", SCRATCH);
  shell("touch", `${SCRATCH}/globprobe_a`);
  assert.equal(shell(`cd ${SCRATCH} && echo globprobe_?`), "globprobe_a");
  assert.equal(shell(`cd ${SCRATCH} && echo globprobe_[a-z]`), "globprobe_a");
  shell("rm", "-f", `${SCRATCH}/globprobe_a`);
});

test("a lone shell argument is forwarded as the command line", { skip }, () => {
  // sweepStaleArtifacts and the fused observe command both depend on this: several arguments get
  // quoted individually, which would send `-name 'deveco_ui_*'` with its quotes attached.
  assert.match(shell("echo one && echo two"), /one\s+two/);
});

test("the success markers this pack matches on are the ones the tools print", { skip }, () => {
  shell("mkdir", "-p", SCRATCH);
  const capture = shell("snapshot_display", "-f", `${SCRATCH}/c.jpeg`, "-t", "jpeg");
  assert.match(capture, /success:/i, "snapshot_display success marker");
  assert.match(capture, /process:[^\n]*?width:\s*\d+[^\n]*?height:\s*\d+/i, "native size line");
  assert.match(capture, /success:[^\n]*?width:\s*\d+[^\n]*?height:\s*\d+/i, "written size line");

  assert.match(shell("uitest", "dumpLayout", "-p", `${SCRATCH}/c.json`), /DumpLayout saved to/i);
  assert.match(shell("uitest", "screenCap", "-p", `${SCRATCH}/c.png`), /ScreenCap saved to/i);
  // uiInput reports a successful gesture as this literal string; there is no exit code to trust.
  assert.match(shell("uitest", "uiInput", "keyEvent", "Back"), /No Error/i);
});

test("the device tar is readable by the bundled ustar reader", { skip }, () => {
  // toybox writes the older GNU magic ("ustar ", not POSIX "ustar\0"). The reader was written
  // against the POSIX one and rejected every real archive until this was measured.
  shell("mkdir", "-p", SCRATCH);
  shell("snapshot_display", "-f", `${SCRATCH}/t.jpeg`, "-t", "jpeg");
  shell("uitest", "dumpLayout", "-p", `${SCRATCH}/t.json`);
  assert.match(shell(`cd ${SCRATCH} && rm -f t.tar && tar cf t.tar t.jpeg t.json && echo TAR_OK`), /TAR_OK/);

  const local = `${process.env.TMPDIR ?? "/tmp"}/deveco-canary-${process.pid}.tar`;
  spawnSync(HDC, ["-t", device, "file", "recv", `${SCRATCH}/t.tar`, local], { encoding: "utf8" });
  const files = readTar(readFileSync(local));
  assert.equal(files.size, 2);
  assert.equal(files.get("t.jpeg").subarray(0, 2).toString("hex"), "ffd8", "JPEG magic survived the round trip");
  assert.equal(typeof JSON.parse(files.get("t.json").toString("utf8")), "object");
});

test("find supports the age-bounded sweep", { skip }, () => {
  // sweepStaleArtifacts relies on -mmin and -delete, and on only removing what is genuinely old:
  // another process may be mid-capture against the same device.
  shell("touch", "/data/local/tmp/deveco_ui_canary_fresh.json");
  shell("touch", "-t", "202601010000", "/data/local/tmp/deveco_ui_canary_old.json");
  shell("find /data/local/tmp -maxdepth 1 -name 'deveco_ui_*' -mmin +60 -delete");
  const listing = shell("ls", "/data/local/tmp");
  assert.ok(!listing.includes("deveco_ui_canary_old"), "an hour-old artifact must be swept");
  assert.ok(listing.includes("deveco_ui_canary_fresh"), "a fresh one must survive: it may be in flight");
  shell("rm", "-f", "/data/local/tmp/deveco_ui_canary_fresh.json");
});

test("two concurrent uitest clients still collide the way the lock assumes", { skip, timeout: 120000 }, async () => {
  // The entire reason src/device-lock.mjs exists. The loser does not fail fast: it blocks for
  // roughly 30 seconds and then reports this string, which is what UI_DEVICE_BUSY keys on.
  shell("mkdir", "-p", SCRATCH);
  // spawn, not spawnSync: the point is two clients in flight at once, and a synchronous spawn
  // inside Promise.all would simply run them one after the other and observe no collision at all.
  const dump = (target) => new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(HDC, ["-t", device, "shell", "uitest", "dumpLayout", "-p", target]);
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    child.once("close", () => resolve({ out, ms: Date.now() - started }));
  });
  const results = await Promise.all([dump(`${SCRATCH}/p1.json`), dump(`${SCRATCH}/p2.json`)]);
  const outputs = results.map((entry) => entry.out);
  const succeeded = outputs.filter((out) => /DumpLayout saved to/i.test(out));
  assert.ok(succeeded.length >= 1, "at least one client must win");
  if (succeeded.length === 1) {
    const loser = outputs.find((out) => !/DumpLayout saved to/i.test(out));
    assert.match(
      loser,
      /Wait for subscribe uitest\.broadcast\.command\.reply timeout/i,
      "the contention signature UI_DEVICE_BUSY keys on has changed",
    );
  }
});

test.after(() => {
  if (!skip) shell("rm", "-rf", SCRATCH);
});

