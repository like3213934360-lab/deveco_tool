import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { tools } from "../src/core/contracts.js";
import { ProcessService } from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import { EmulatorService } from "../src/services/emulator.js";
import { withTrace } from "../src/core/trace.js";
import { ToolError } from "../src/core/errors.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";

function fixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "native-emulator-protocol-")),
  );
  const file = path.join(root, "instance.json"),
    directory = path.join(root, "agreement"),
    config = file + ".config";
  fs.mkdirSync(directory);
  const instancePath = path.join(root, "instance");
  fs.mkdirSync(instancePath);
  fs.writeFileSync(path.join(instancePath, "config.ini"), `name=fixture\nuuid=fixture-uuid\ninstancePath=${instancePath}\nhw.hdc.port=5555\n`);
  fs.writeFileSync(file, JSON.stringify({ name: "fixture", isRunning: true, instancePath }));
  for (const name of [
    "HarmonyOS_Software_Service_Agreement",
    "HarmonyOS_SDK_Agreement",
  ])
    fs.writeFileSync(
      path.join(directory, name + ".txt"),
      "Fixture agreement: " + name,
    );
  fs.writeFileSync(
    config,
    "unrelated:keep\nHarmonyOS_Software_Service_Agreement:disagree\nHarmonyOS_SDK_Agreement:agree\n",
  );
  const store = new StateStore(path.join(root, "state")),
    processes = new ProcessService(new PersistentProcessObserver(store));
  const service = new EmulatorService(
    processes,
    store,
    (args) => ({
      executable: process.execPath,
      args: [
        fileURLToPath(
          new URL("./fixtures/native-emulator.js", import.meta.url),
        ),
        file,
        ...args,
      ],
    }),
    () => ({ directory, config }),
  );
  const commands = (): string[][] =>
    fs.existsSync(file + ".commands")
      ? fs
          .readFileSync(file + ".commands", "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
      : [];
  return {
    root,
    file,
    config,
    directory,
    store,
    processes,
    service,
    commands,
    close: async () => {
      await service.close();
      await processes.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("emulator schemas reject ignored fields and invalid scenario values before starting any SDK process", async () => {
  const f = fixture();
  try {
    for (const input of [
      { action: "list", name: "fixture" },
      { action: "create", name: "fixture" },
      { action: "image_install", device_type: "phone" },
      { action: "stop", name: "-force" },
      { action: "license_accept" },
      { action: "license_view", license_sha256: "a".repeat(64) },
    ])
      await assert.rejects(f.service.manage(input), { name: "ZodError" });
    for (const input of [
      { action: "rotation", direction: "up" },
      { action: "shake", value: 1 },
      { action: "folded_state", state: "invented" },
      { action: "battery", value: 0.5 },
      { action: "battery_status", value: 2 },
      { action: "gps", key: "latitude", value: 91 },
      { action: "gps", key: "bearing", value: 359.991 },
      { action: "gps", key: "humidity", value: 5 },
      { action: "sensor", key: "steps", value: 0.1 },
      { action: "sensor", key: "steps", value: 100001 },
      { action: "sensor", key: "heartrate", value: 256 },
      { action: "sensor", key: "temperature", value: -273.2 },
      { action: "sensor", key: "light", value: 20.33 },
    ])
      await assert.rejects(f.service.scenario({ name: "fixture", target: "127.0.0.1:5555", ...input }), {
        name: "ZodError",
      });
    assert.deepEqual(f.commands(), []);
    assert.equal(
      tools.emulator_scenario.schema.safeParse({
        name: "fixture",
        target: "127.0.0.1:5555",
        action: "sensor",
        key: "steps",
        value: 100000,
      }).success,
      true,
    );
  } finally {
    await f.close();
  }
});

test("emulator scenarios require advertised native options and positive receipts", async () => {
  const f = fixture();
  try {
    const cases = [
      [{ action: "rotation", direction: "left" }, ["-rotation", "left"]],
      [
        { action: "folded_state", state: "half-open" },
        ["-foldedState", "half-open"],
      ],
      [
        { action: "gps", key: "latitude", value: 39.915599 },
        ["-gps", "-latitude", "39.915599"],
      ],
      [
        { action: "sensor", key: "steps", value: 23000 },
        ["-sensor", "-steps", "23000"],
      ],
      [{ action: "battery_status", value: 1 }, ["-batteryStatus", "1"]],
      [{ action: "driving_navigation" }, ["-drivingNavigation"]],
    ] as const;
    for (const [input, args] of cases) {
      const result = await f.service.scenario({ name: "fixture", target: "127.0.0.1:5555", ...input });
      assert.equal(result.commandAccepted, true);
      assert.equal(result.stateVerified, false);
      assert.deepEqual(f.commands().at(-1), ["-instance", "fixture", ...args]);
    }
    const before = f
      .commands()
      .filter((args) => args[0] === "-instance").length;
    for (const key of ["humidity", "temperature"])
      await assert.rejects(
        f.service.scenario({
          name: "fixture",
          target: "127.0.0.1:5555",
          action: "sensor",
          key,
          value: 20,
        }),
        { code: "EMULATOR_CAPABILITY_UNAVAILABLE" },
      );
    assert.equal(
      f.commands().filter((args) => args[0] === "-instance").length,
      before,
    );
    assert.equal(
      f.commands().filter((args) => args[0] === "-version").length,
      1,
    );
    assert.equal(f.commands().filter((args) => args[0] === "-help").length, 1);
    for (const [output, code] of [
      ["", "EMULATOR_SCENARIO_UNCONFIRMED"],
      ["Scenario simulation failed: unavailable", "EMULATOR_FAILED"],
      [
        "Scenario simulation success.\nScenario simulation failed: ignored",
        "EMULATOR_FAILED",
      ],
    ]) {
      fs.writeFileSync(f.file + ".response", output!);
      await assert.rejects(
        f.service.scenario({ name: "fixture", target: "127.0.0.1:5555", action: "shake" }),
        { code },
      );
    }
  } finally {
    await f.close();
  }
});

test("license viewing reads current SDK bytes and preserves configuration; changed reviews cannot accept", async () => {
  const f = fixture();
  try {
    const before = fs.readFileSync(f.config),
      stat = fs.statSync(f.config);
    const result = await f.service.manage({ action: "license_view" });
    assert.ok("agreements" in result && result.agreements);
    assert.equal(result.accepted, false);
    assert.equal(result.agreements.length, 2);
    assert.equal(result.agreements[1]?.accepted, true);
    for (const entry of result.agreements) {
      const bytes = fs.readFileSync(
        path.join(f.directory, entry.name + ".txt"),
      );
      assert.equal(
        entry.sha256,
        crypto.createHash("sha256").update(bytes).digest("hex"),
      );
      assert.equal(entry.bytes, bytes.length);
      assert.equal(entry.artifact.bytes, bytes.length);
    }
    assert.deepEqual(fs.readFileSync(f.config), before);
    assert.equal(fs.statSync(f.config).mtimeMs, stat.mtimeMs);
    assert.deepEqual(f.commands(), [["-version"]]);
    fs.appendFileSync(
      path.join(f.directory, "HarmonyOS_SDK_Agreement.txt"),
      " revised",
    );
    await assert.rejects(
      f.service.manage({
        action: "license_accept",
        license_sha256: result.license_sha256,
      }),
      { code: "EMULATOR_LICENSE_CHANGED" },
    );
    assert.equal(
      f.commands().some((args) => args[0] === "-license"),
      false,
    );
    assert.deepEqual(fs.readFileSync(f.config), before);
    const current = await f.service.manage({ action: "license_view" });
    assert.ok("license_sha256" in current);
    fs.writeFileSync(f.file + ".license-unconfirmed", "fixture");
    await assert.rejects(
      f.service.manage({
        action: "license_accept",
        license_sha256: current.license_sha256,
      }),
      { code: "EMULATOR_LICENSE_UNCONFIRMED" },
    );
    fs.rmSync(f.file + ".license-unconfirmed");
    const accepted = await f.service.manage({
      action: "license_accept",
      license_sha256: current.license_sha256,
    });
    assert.ok("verified" in accepted && accepted.verified);
    assert.equal(
      fs.readFileSync(f.config, "utf8").startsWith("unrelated:keep\n"),
      true,
    );
    const calls = f.commands().filter((args) => args[0] === "-license").length;
    const again = await f.service.manage({
      action: "license_accept",
      license_sha256: current.license_sha256,
    });
    assert.ok("unchanged" in again && again.unchanged);
    assert.equal(
      f.commands().filter((args) => args[0] === "-license").length,
      calls,
    );
  } finally {
    await f.close();
  }
});

test("missing or oversized installed license files and ambiguous native config never trigger acceptance", async () => {
  const f = fixture();
  try {
    const file = path.join(f.directory, "HarmonyOS_SDK_Agreement.txt"),
      content = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(f.service.manage({ action: "license_view" }), {
      code: "EMULATOR_LICENSE_INVALID",
    });
    fs.rmSync(file);
    await assert.rejects(f.service.manage({ action: "license_view" }), {
      code: "EMULATOR_LICENSE_UNAVAILABLE",
    });
    fs.writeFileSync(file, content);
    fs.appendFileSync(f.config, "HarmonyOS_SDK_Agreement:disagree\n");
    await assert.rejects(f.service.manage({ action: "license_view" }), {
      code: "EMULATOR_LICENSE_CONFIG_INVALID",
    });
    assert.equal(
      f.commands().some((args) => args[0] === "-license"),
      false,
    );
  } finally {
    await f.close();
  }
});

test("license recovery retires only its exact interrupted command after SDK acceptance without redispatch", async () => {
  const f = fixture();
  const originalRun = f.processes.run.bind(f.processes);
  try {
    const review = await f.service.manage({ action: "license_view" });
    const input = { action: "license_accept", license_sha256: review.license_sha256 };
    const { run } = f.store.create("native_operation", input);
    f.processes.run = async (command, options = {}) => {
      if (!command.args.includes("-license")) return originalRun(command, options);
      await originalRun(command, { ...options, onSettled: undefined });
      throw new ToolError("FIXTURE_RESPONSE_LOST", "SDK accepted the license before the host lost its completion receipt");
    };
    await withTrace({ run_id: run.id, node: "execute_native_operation" }, async () => {
      await assert.rejects(f.service.manage(input), { code: "EFFECT_UNCERTAIN" });
      assert.equal(f.store.uncertainOperations(run.id).length, 2);
      f.processes.run = originalRun;
      const recovered = await f.service.manage(input);
      assert.equal(recovered.accepted, true);
      assert.equal(recovered.unchanged, true);
      assert.deepEqual(f.store.uncertainOperations(run.id), []);
      f.store.assertStopped(run.id);
      await f.service.manage(input);
    });
    assert.equal(f.commands().filter((args) => args[0] === "-license").length, 1);
  } finally {
    f.processes.run = originalRun;
    await f.close();
  }
});
