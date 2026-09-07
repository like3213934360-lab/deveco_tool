import { z } from "zod";
import fs from "node:fs";
import { digest } from "../core/files.js";
import { setTimeout as delay } from "node:timers/promises";
import { ProcessService } from "../core/process.js";
import { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";
import { discoverToolchain, toolCommand } from "../core/toolchain.js";
import type { Command } from "../core/process.js";
import { withinDeadline } from "../core/deadline.js";
import { invariant } from "../core/errors.js";
import { tools } from "../core/contracts.js";
import {
  emulatorLicenseLocation,
  emulatorLicenseStatus,
  readEmulatorLicenses,
  type EmulatorLicenseLocation,
} from "./emulator-license.js";

const instanceSchema = z.object({
  name: z.string().min(1),
  isRunning: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true"),
  deviceType: z.string().optional(),
  instancePath: z.string().optional(),
  "os.osVersion": z.string().optional(),
});
export class EmulatorService {
  private protocol?: { identity: string; help: string };
  private readonly sessions = new Map<
    string,
    ReturnType<ProcessService["startSession"]>
  >();
  constructor(
    readonly processes: ProcessService,
    readonly store: StateStore,
    private readonly command: (args: string[]) => Command = (args) =>
      toolCommand(discoverToolchain(), "emulator", args),
    private readonly licenseLocation: (
      executable: string,
      version: string,
    ) => EmulatorLicenseLocation = emulatorLicenseLocation,
  ) {}
  private async execute(
    args: string[],
    signal?: AbortSignal,
    timeoutMs = 30000,
  ) {
    const result = await this.processes.run(this.command(args), {
      signal,
      timeoutMs,
    });
    invariant(
      !result.truncated,
      "EMULATOR_OUTPUT_TRUNCATED",
      "Native emulator response exceeded its output budget",
    );
    invariant(
      !/Invalid command|无效命令|please attach the correct parameter|Scenario simulation failed|Device create fail|no images are available|license.*(?:not accepted|need to be reviewed)|agreement.*(?:not accepted|not agree)/i.test(
        result.stdout + result.stderr,
      ),
      "EMULATOR_FAILED",
      (result.stdout + result.stderr).slice(-4000),
    );
    return result.stdout;
  }
  async list(signal?: AbortSignal) {
    return z
      .array(instanceSchema)
      .parse(
        JSON.parse(
          await this.execute(["-list", "-details"], signal),
        ) as unknown,
      );
  }
  private async start(name: string, signal?: AbortSignal) {
    invariant(
      this.sessions.size < 4,
      "EMULATOR_SESSION_CAPACITY",
      "At most four owned emulator sessions",
    );
    const session = this.processes.startSession(
      this.command(["-start", name, "-bootmode", "snapshot"]),
    );
    this.sessions.set(name, session);
    try {
      return await withinDeadline(
        120000,
        signal,
        "EMULATOR_START_TIMEOUT",
        async (active) => {
          for (;;) {
            active.throwIfAborted();
            session.check();
            const instance = (await this.list(active)).find(
              (item) => item.name === name,
            );
            session.check();
            if (instance?.isRunning)
              return {
                action: "start",
                verified: true,
                instance,
                launcher_pid: session.pid,
              };
            await delay(250, undefined, { signal: active });
          }
        },
      );
    } catch (error) {
      await this.stopOwned(name, session);
      throw error;
    }
  }
  private async stopOwned(
    name: string,
    session: ReturnType<ProcessService["startSession"]>,
  ) {
    // A launcher may hand the emulator to another process group. Confirm native inventory as well.
    await withinDeadline(
      60000,
      undefined,
      "CANCEL_UNCONFIRMED",
      async (signal) => {
        if (
          (await this.list(signal)).some(
            (item) => item.name === name && item.isRunning,
          )
        ) {
          await this.execute(["-stop", name], signal);
          while (
            (await this.list(signal)).some(
              (item) => item.name === name && item.isRunning,
            )
          )
            await delay(250, undefined, { signal });
        }
        await session.stop();
      },
    );
    this.sessions.delete(name);
  }
  async close() {
    this.protocol = undefined;
    const results = await Promise.allSettled(
      [...this.sessions].map(([name, session]) =>
        this.stopOwned(name, session),
      ),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  async manage(raw: unknown, signal?: AbortSignal) {
    const input = tools.emulator_manage.schema.parse(raw);
    if (input.action === "license_view" || input.action === "license_accept")
      return this.license(input.action, input.license_sha256, signal);
    if (input.action === "list") return { instances: await this.list(signal) };
    if (input.action === "images")
      return {
        images: await this.images(input.device_type, input.downloaded, signal),
      };
    return this.store.lease(
      "emulator:inventory",
      async () => {
        if (
          input.action === "image_install" ||
          input.action === "image_uninstall"
        ) {
          invariant(
            input.device_type && input.os_version,
            "IMAGE_INPUT_REQUIRED",
            "device_type and os_version required",
          );
          const before = await this.images(
            input.device_type,
            undefined,
            signal,
          );
          const matching = before.filter(
            (item) =>
              item.deviceType === input.device_type &&
              (item.osVersion === input.os_version ||
                item.SoftWareVersion === input.os_version),
          );
          invariant(
            matching.length === 1 && matching[0],
            "IMAGE_AMBIGUOUS",
            "Choose exactly one image version from images",
          );
          const image = matching[0],
            version =
              input.action === "image_uninstall"
                ? image.SoftWareVersion
                : input.os_version;
          invariant(
            version,
            "IMAGE_VERSION_MISSING",
            "Image did not declare its software version",
          );
          await this.execute(
            [
              input.action === "image_install" ? "-install" : "-uninstall",
              "-deviceType",
              input.device_type,
              "-osVersion",
              version,
              ...(input.action === "image_uninstall" ? ["-force"] : []),
            ],
            signal,
            1800000,
          );
          const after = await this.images(input.device_type, true, signal),
            present = after.some(
              (item) => item.SoftWareVersion === image.SoftWareVersion,
            );
          invariant(
            present === (input.action === "image_install"),
            "IMAGE_STATE_UNCONFIRMED",
            "Image inventory did not confirm operation",
          );
          return { action: input.action, verified: true };
        }
        invariant(input.name, "EMULATOR_NAME_REQUIRED", "name required");
        const before = await this.list(signal),
          found = before.find((item) => item.name === input.name);
        if (input.action === "create") {
          invariant(!found, "EMULATOR_EXISTS", "Instance already exists");
          invariant(
            input.device_type && input.os_version,
            "EMULATOR_INPUT_REQUIRED",
            "device_type and os_version required",
          );
          await this.execute(
            [
              "-create",
              input.name,
              "-deviceType",
              input.device_type,
              "-osVersion",
              input.os_version,
            ],
            signal,
            120000,
          );
        } else {
          invariant(found, "EMULATOR_NOT_FOUND", "Instance does not exist");
          if (input.action === "delete")
            invariant(
              !found.isRunning,
              "EMULATOR_RUNNING",
              "Stop the emulator before deleting it",
            );
          if (
            (input.action === "start" && found.isRunning) ||
            (input.action === "stop" && !found.isRunning)
          )
            return { action: input.action, verified: true, unchanged: true };
          if (input.action === "start") return this.start(input.name, signal);
          await this.execute(
            [
              `-${input.action}`,
              input.name,
              ...(input.action === "delete" ? ["-force"] : []),
            ],
            signal,
            120000,
          );
        }
        const deadline = Date.now() + 120000;
        do {
          const state = (await this.list(signal)).find(
            (item) => item.name === input.name,
          );
          if (
            input.action === "delete"
              ? !state
              : input.action === "create"
                ? !!state
                : state && !state.isRunning
          ) {
            const owned = this.sessions.get(input.name);
            if (input.action === "stop" && owned) {
              await owned.stop();
              this.sessions.delete(input.name);
            }
            return {
              action: input.action,
              verified: true,
              instance: state ?? null,
            };
          }
          await delay(500, undefined, { signal });
        } while (Date.now() < deadline);
        invariant(
          false,
          "EMULATOR_STATE_UNCONFIRMED",
          "Emulator inventory did not confirm operation",
        );
      },
      signal,
    );
  }
  private async license(
    action: "license_view" | "license_accept",
    expected: string | undefined,
    signal?: AbortSignal,
  ) {
    return this.store.lease(
      "emulator:inventory",
      async () => {
        const command = this.command(["-version"]),
          version = (
            await this.processes.run(command, { signal, timeoutMs: 30000 })
          ).stdout;
        const location = this.licenseLocation(command.executable, version),
          review = await readEmulatorLicenses(location, signal);
        if (action === "license_view") {
          const status = await emulatorLicenseStatus(location, signal);
          return {
            action,
            license_sha256: review.license_sha256,
            accepted: status.accepted,
            agreements: review.agreements.map((item) => ({
              name: item.name,
              bytes: item.bytes,
              sha256: item.sha256,
              accepted:
                status.agreements.find((entry) => entry.name === item.name)
                  ?.accepted === true,
              artifact: this.store.artifact(
                currentTrace().run_id ?? "emulator-license",
                item.content,
              ),
            })),
          };
        }
        invariant(
          expected === review.license_sha256,
          "EMULATOR_LICENSE_CHANGED",
          "Read and review the current license files before accepting their exact license_sha256",
        );
        const before = await emulatorLicenseStatus(location, signal);
        if (before.accepted)
          return {
            action,
            accepted: true,
            verified: true,
            unchanged: true,
            license_sha256: review.license_sha256,
          };
        // Only this explicit action may accept; view/start/image operations never write agreement flags.
        await this.execute(["-license", "accept"], signal);
        const after = await emulatorLicenseStatus(location, signal),
          current = await readEmulatorLicenses(location, signal);
        invariant(
          after.accepted && current.license_sha256 === review.license_sha256,
          "EMULATOR_LICENSE_UNCONFIRMED",
          "Native configuration did not confirm acceptance of the reviewed agreements",
        );
        return {
          action,
          accepted: true,
          verified: true,
          license_sha256: review.license_sha256,
        };
      },
      signal,
    );
  }
  private async images(
    deviceType?: string,
    downloaded?: boolean,
    signal?: AbortSignal,
  ) {
    const schema = z.array(
      z.object({
        deviceType: z.string(),
        osVersion: z.string(),
        SoftWareVersion: z.string(),
        downloaded: z
          .union([z.boolean(), z.enum(["true", "false"])])
          .optional(),
      }),
    );
    return schema.parse(
      JSON.parse(
        await this.execute(
          [
            "-imageList",
            ...(deviceType ? ["-deviceType", deviceType] : []),
            ...(downloaded !== undefined
              ? ["-downloaded", String(downloaded)]
              : []),
          ],
          signal,
        ),
      ) as unknown,
    );
  }
  private async scenarioHelp(signal?: AbortSignal) {
    const command = this.command(["-version"]),
      stat = await fs.promises.stat(command.executable);
    const identity = digest({
      command,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
    });
    if (this.protocol?.identity === identity) return this.protocol.help;
    const version = await this.execute(["-version"], signal);
    invariant(
      Number(version.match(/\b(\d+)\.\d+\.\d+/)?.[1]) >= 7,
      "EMULATOR_PROTOCOL_UNSUPPORTED",
      "Scenario control needs emulator component 7 or later",
    );
    const help = await this.execute(["-help"], signal);
    this.protocol = { identity, help };
    return help;
  }
  async scenario(raw: unknown, signal?: AbortSignal) {
    const input = tools.emulator_scenario.schema.parse(raw);
    return this.store.lease(
      "emulator:inventory",
      async () => {
        const help = await this.scenarioHelp(signal);
        invariant(
          (await this.list(signal)).some(
            (item) => item.name === input.name && item.isRunning,
          ),
          "EMULATOR_NOT_RUNNING",
          "Scenario requires a running emulator",
        );
        const commands = {
          shake: "shake",
          power: "power",
          rotation: "rotation",
          volume: "volume",
          folded_state: "foldedState",
          battery: "battery",
          battery_status: "batteryStatus",
          gps: "gps",
          outdoor_running: "outdoorRunning",
          outdoor_cycling: "outdoorCycling",
          driving_navigation: "drivingNavigation",
          sensor: "sensor",
        };
        const args = ["-instance", input.name, `-${commands[input.action]}`];
        if (input.action === "rotation" || input.action === "volume") {
          invariant(
            input.direction &&
              (input.action === "rotation"
                ? ["left", "right"]
                : ["up", "down"]
              ).includes(input.direction),
            "SCENARIO_INPUT_INVALID",
            "Invalid direction",
          );
          args.push(input.direction);
        }
        if (input.action === "folded_state") {
          invariant(input.state, "SCENARIO_INPUT_REQUIRED", "state required");
          args.push(input.state);
        }
        if (input.action === "battery" || input.action === "battery_status") {
          invariant(
            input.value !== undefined &&
              Number.isInteger(input.value) &&
              input.value >= 0 &&
              input.value <= (input.action === "battery" ? 100 : 1),
            "SCENARIO_INPUT_INVALID",
            "Invalid battery value",
          );
          args.push(String(input.value));
        }
        if (input.action === "gps" || input.action === "sensor") {
          invariant(
            input.key &&
              input.value !== undefined &&
              (input.action === "gps"
                ? ["longitude", "latitude", "altitude", "bearing"]
                : ["light", "humidity", "temperature", "steps", "heartrate"]
              ).includes(input.key),
            "SCENARIO_INPUT_INVALID",
            "Matching key/value required",
          );
          args.push(`-${input.key}`, String(input.value));
        }
        for (const option of [
          args[2],
          ...(input.action === "gps" || input.action === "sensor"
            ? [args[3]]
            : []),
        ])
          invariant(
            option &&
              new RegExp(`(?:^|[^\\w-])${option}(?![\\w-])`, "m").test(help),
            "EMULATOR_CAPABILITY_UNAVAILABLE",
            `Installed emulator does not declare ${option}`,
          );
        const output = await this.execute(args, signal);
        invariant(
          /Scenario simulation success\./i.test(output),
          "EMULATOR_SCENARIO_UNCONFIRMED",
          "Native emulator did not confirm accepting the scenario command",
        );
        return { commandAccepted: true, stateVerified: false, output };
      },
      signal,
    );
  }
}
