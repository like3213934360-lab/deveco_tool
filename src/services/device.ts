import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  selectorSchema,
  controlSchema,
  type Selector,
  appSchema,
  type ApplicationTarget,
} from "../core/contracts.js";
export {
  selectorSchema,
  controlSchema,
  type Selector,
} from "../core/contracts.js";
import { setTimeout as delay } from "node:timers/promises";
import { invariant, SettledEffectError, ToolError } from "../core/errors.js";
import { ProcessService, type ProcessResult } from "../core/process.js";
import { discoverToolchain, toolCommand } from "../core/toolchain.js";
import { StateStore } from "../core/store.js";
import { privateDirectory } from "../core/files.js";
import { withinDeadline } from "../core/deadline.js";
import { inspectApplicationPackages } from "./package.js";

import { UiIndex, isWindowSurface, type Rect, type UiNode } from "./ui-tree.js";
import {
  captureFile,
  verifyCapturedFile,
  type CapturedFile,
} from "../core/captured-file.js";
import { currentTrace } from "../core/trace.js";
import { CpuPool } from "../core/cpu-pool.js";
import { parseUiDump } from "./ui-parse.js";
import { ScreenshotService } from "./screenshot.js";
import { connectedTargets, deviceProperties } from "./device-info.js";
import { DeviceEffectJournal, type DeviceReceipt } from "./device-effect.js";
import {
  needsControlSnapshot,
  resolveControl,
  uiInputArguments,
} from "./ui-control.js";
export {
  UiIndex,
  flattenDump,
  parseRect,
  selectNodes,
  type Rect,
  type UiNode,
} from "./ui-tree.js";
export interface Snapshot {
  id: string;
  device: string;
  created: number;
  nodes: UiNode[];
  query: UiIndex;
  signature: string;
  structureSignature: string;
}
export class DeviceService {
  private readonly screenshots: ScreenshotService;
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly snapshotBytes = new Map<string, number>();
  private cacheBytes = 0;
  private cacheTimer?: NodeJS.Timeout;
  private readonly cacheLimit = 64 * 1024 * 1024;
  get cacheMetrics() {
    return {
      snapshots: this.snapshots.size,
      estimated_bytes: this.cacheBytes,
      max_bytes: this.cacheLimit,
      max_snapshots: 8,
    };
  }
  private evictSnapshot(id: string) {
    this.snapshots.delete(id);
    this.cacheBytes -= this.snapshotBytes.get(id) ?? 0;
    this.snapshotBytes.delete(id);
  }
  private expireSnapshots() {
    clearTimeout(this.cacheTimer);
    const now = Date.now();
    for (const [id, snapshot] of this.snapshots)
      if (now - snapshot.created >= 30000) this.evictSnapshot(id);
    const oldest = this.snapshots.values().next().value;
    this.cacheTimer = oldest
      ? setTimeout(
          () => this.expireSnapshots(),
          Math.max(1, oldest.created + 30000 - now),
        )
      : undefined;
    this.cacheTimer?.unref();
  }
  private retainSnapshot(snapshot: Snapshot) {
    // Account conservatively for nodes, lazy indexes, strings and lowercase keys.
    let bytes = snapshot.nodes.length * 512;
    for (const node of snapshot.nodes)
      for (const value of Object.values(node))
        if (typeof value === "string") bytes += value.length * 4;
    invariant(
      bytes <= this.cacheLimit,
      "UI_CACHE_CAPACITY",
      "UI snapshot exceeds the 64 MiB cache accounting budget",
    );
    this.expireSnapshots();
    for (const id of this.snapshots.keys()) {
      if (this.snapshots.size < 8 && this.cacheBytes + bytes <= this.cacheLimit)
        break;
      this.evictSnapshot(id);
    }
    this.snapshots.set(snapshot.id, snapshot);
    this.snapshotBytes.set(snapshot.id, bytes);
    this.cacheBytes += bytes;
    this.expireSnapshots();
  }
  close() {
    this.screenshots.close();
    clearTimeout(this.cacheTimer);
    this.snapshots.clear();
    this.snapshotBytes.clear();
    this.cacheBytes = 0;
  }
  constructor(
    readonly processes: ProcessService,
    readonly store: StateStore,
    readonly cpu?: CpuPool,
  ) {
    this.screenshots = new ScreenshotService(store, this);
  }
  async command(
    args: string[],
    signal?: AbortSignal,
    timeoutMs = 30000,
    sensitive = false,
  ): Promise<ProcessResult> {
    const result = await this.processes.run(
      { ...toolCommand(discoverToolchain(), "hdc", args), sensitive },
      { signal, timeoutMs },
    );
    invariant(
      !/^\s*(?:\[Fail\]|Connect server failed|\[E\].*(?:connect|transport|device))/im.test(
        result.stdout + result.stderr,
      ),
      "HDC_FAILED",
      (result.stdout + result.stderr).slice(-4000),
    );
    return result;
  }
  async targets(signal?: AbortSignal): Promise<string[]> {
    return connectedTargets(await this.command(["list", "targets"], signal));
  }
  async target(target?: string, signal?: AbortSignal): Promise<string> {
    const targets = await this.targets(signal);
    if (target) {
      invariant(
        targets.includes(target),
        "DEVICE_NOT_FOUND",
        "Requested device is not connected",
      );
      return target;
    }
    invariant(
      targets.length === 1 && targets[0],
      "DEVICE_AMBIGUOUS",
      "Specify target when zero or multiple devices are connected",
    );
    return targets[0];
  }
  async shell(
    target: string,
    args: string[],
    signal?: AbortSignal,
    timeoutMs = 30000,
    allowFailure = false,
    sensitive = false,
  ) {
    // HDC joins shell arguments. Quote each literal for the remote POSIX shell.
    const quoted = args
      .map((value) => `'${value.replaceAll("'", "'\\''")}'`)
      .join(" ");
    const marker = `__DEVECO_EXIT_${crypto.randomBytes(8).toString("hex")}__=`;
    const result = await this.command(
      [
        "-t",
        target,
        "shell",
        `${quoted}; result=$?; printf '\\n${marker}%s\\n' "$result"`,
      ],
      signal,
      timeoutMs,
      sensitive,
    );
    const receipt = new RegExp(`\\r?\\n${marker}(\\d+)\\s*$`).exec(
      result.stdout,
    );
    invariant(
      receipt,
      "HDC_RECEIPT_MISSING",
      "Remote command did not return an exit receipt",
    );
    const stdout = result.stdout.slice(0, receipt.index),
      exitCode = Number(receipt[1]);
    invariant(
      allowFailure || exitCode === 0,
      "HDC_REMOTE_FAILED",
      `Remote command exited with ${exitCode}: ${(stdout + result.stderr).slice(-4000)}`,
    );
    return { ...result, stdout, exitCode };
  }
  async info(target?: string, signal?: AbortSignal) {
    const id = await this.target(target, signal);
    const result = await this.shell(id, ["param", "get"], signal);
    return deviceProperties(id, result);
  }
  invalidate(target: string): void {
    for (const [key, value] of this.snapshots)
      if (value.device === target) this.evictSnapshot(key);
    this.expireSnapshots();
  }
  async snapshot(target: string, signal?: AbortSignal): Promise<Snapshot> {
    return this.store.lease(
      `device:${target}`,
      async () => {
        const id = crypto.randomUUID();
        const remote = `/data/local/tmp/deveco-${id}.json`;
        const local = path.join(this.store.root, "tmp", `${id}.json`);
        privateDirectory(path.dirname(local));
        try {
          const dump = await this.shell(
            target,
            ["uitest", "dumpLayout", "-p", remote],
            signal,
          );
          invariant(
            !/another uitest|failed|error:/i.test(dump.stdout + dump.stderr),
            "UI_DUMP_FAILED",
            dump.stdout + dump.stderr,
          );
          await this.command(
            ["-t", target, "file", "recv", remote, local],
            signal,
          );
          invariant(
            fs.existsSync(local) && fs.statSync(local).size <= 32 * 1024 * 1024,
            "UI_DUMP_INVALID",
            "Missing or oversized UI dump",
          );
          const content = await fs.promises.readFile(local, "utf8");
          signal?.throwIfAborted();
          const parsed =
            this.cpu && content.length >= 128 * 1024
              ? await this.cpu.run({ kind: "ui", content }, signal)
              : parseUiDump(content);
          const value: Snapshot = {
            id,
            device: target,
            created: Date.now(),
            ...parsed,
            query: new UiIndex(parsed.nodes),
          };
          this.retainSnapshot(value);
          return value;
        } finally {
          fs.rmSync(local, { force: true });
          await this.shell(target, ["rm", "-f", remote], undefined, 5000).catch(
            () => {},
          );
        }
      },
      signal,
    );
  }
  async find(
    target: string,
    input: unknown,
    snapshotId?: string,
    signal?: AbortSignal,
  ) {
    const snapshot = snapshotId
      ? this.snapshots.get(snapshotId)
      : await this.snapshot(target, signal);
    invariant(
      snapshot &&
        snapshot.device === target &&
        Date.now() - snapshot.created <= 30000,
      "SNAPSHOT_EXPIRED",
      "Take a new UI snapshot",
    );
    return this.query(snapshot, input);
  }
  query(snapshot: Snapshot, input: unknown) {
    const selector = selectorSchema.parse(input);
    const matches = snapshot.query.select(selector);
    return {
      snapshot_id: snapshot.id,
      signature: snapshot.signature,
      structureSignature: snapshot.structureSignature,
      nodeCount: snapshot.nodes.length,
      matchCount: matches.length,
      matches: matches.slice(0, selector.limit),
    };
  }
  async findMany(
    target: string,
    queries: { id: string; selector: Selector }[],
    snapshotId?: string,
    signal?: AbortSignal,
  ) {
    const snapshot = snapshotId
      ? this.snapshots.get(snapshotId)
      : await this.snapshot(target, signal);
    invariant(
      snapshot &&
        snapshot.device === target &&
        Date.now() - snapshot.created < 30000,
      "SNAPSHOT_EXPIRED",
      "Take a new UI snapshot",
    );
    return {
      snapshot_id: snapshot.id,
      signature: snapshot.signature,
      structure_signature: snapshot.structureSignature,
      node_count: snapshot.nodes.length,
      queries: queries.map((query) => {
        const result = this.query(snapshot, query.selector);
        return {
          id: query.id,
          match_count: result.matchCount,
          matches: result.matches,
          truncated: result.matchCount > result.matches.length,
        };
      }),
    };
  }
  screenshot(target: string, input: unknown = {}, signal?: AbortSignal) {
    return this.screenshots.capture(target, input, signal);
  }
  async control(
    target: string,
    raw: unknown,
    signal?: AbortSignal,
    captured?: Snapshot,
  ) {
    const input = controlSchema.parse(raw);
    return this.store.lease(
      `device:${target}`,
      async () => {
        let snapshot: Snapshot | undefined;
        if (needsControlSnapshot(input)) {
          snapshot = captured ?? (await this.snapshot(target, signal));
          invariant(
            snapshot.device === target &&
              Date.now() - snapshot.created <= 30000 &&
              (!captured || this.snapshots.get(captured.id) === captured),
            "SNAPSHOT_EXPIRED",
            "The prepared control snapshot is no longer available",
          );
        }
        const resolved = resolveControl(input, snapshot);
        const args = uiInputArguments(resolved);
        this.invalidate(target);
        if (resolved.action === "inputText") {
          const { pasteText } = await import("./text.js");
          return pasteText(
            this,
            target,
            {
              x: resolved.x!,
              y: resolved.y!,
              ...(resolved.display_id === undefined
                ? {}
                : { displayId: resolved.display_id }),
            },
            resolved.text!,
            signal,
          );
        }
        const result = await this.shell(
          target,
          ["uitest", "uiInput", ...args],
          signal,
        );
        const receipt = result.stdout.trim();
        invariant(
          !result.stderr.trim() && (receipt === "" || receipt === "No Error"),
          "UI_ACTION_FAILED",
          result.stdout + result.stderr,
        );
        return { commandAccepted: true, outcomeVerified: false };
      },
      signal,
    );
  }
  async verify(
    target: string,
    assertion: {
      visible?: unknown;
      hidden?: unknown;
      timeoutMs?: number;
      alternates?: unknown[];
    },
    signal?: AbortSignal,
    expectedBundle?: string,
  ) {
    invariant(
      (assertion.visible !== undefined) !== (assertion.hidden !== undefined),
      "ASSERTION_REQUIRED",
      "Provide exactly one visible or hidden selector",
    );
    const selector = selectorSchema.parse(
        assertion.visible ?? assertion.hidden,
      ),
      alternates = (assertion.alternates ?? []).map((raw) =>
        selectorSchema.parse(raw),
      );
    const deadline = Date.now() + (assertion.timeoutMs ?? 5000);
    return withinDeadline(
      assertion.timeoutMs ?? 5000,
      signal,
      "VERIFICATION_FAILED",
      async (signal) => {
        do {
          const snapshot = await this.snapshot(target, signal),
            nodes = expectedBundle
              ? snapshot.nodes.filter(
                  (node) => node.bundleName === expectedBundle,
                )
              : snapshot.nodes;
          const appReady =
            !expectedBundle ||
            nodes.some(
              (node) =>
                isWindowSurface(node) &&
                node.rect &&
                node.visible !== false &&
                node.focused !== false,
            );
          const query = expectedBundle ? new UiIndex(nodes) : snapshot.query;
          const primary = query.select(selector),
            fallbacks = alternates.map((item) =>
              query.select({ ...item, limit: 2 }),
            );
          let matches = primary;
          if (assertion.visible !== undefined && primary.length === 0) {
            invariant(
              fallbacks.every((items) => items.length <= 1),
              "UI_TARGET_AMBIGUOUS",
              "Assertion alternatives match several UI controls",
            );
            matches = [...new Set(fallbacks.flat())];
            invariant(
              matches.length <= 1,
              "UI_TARGET_AMBIGUOUS",
              "Assertion alternatives identify different UI controls",
            );
          }
          if (
            appReady &&
            (assertion.visible !== undefined
              ? matches.length > 0
              : primary.length === 0 &&
                fallbacks.every((items) => items.length === 0))
          )
            return {
              verified: true,
              snapshot_id: snapshot.id,
              signature: snapshot.signature,
              structureSignature: snapshot.structureSignature,
              nodeCount: nodes.length,
              matchCount: matches.length,
              matches: matches.slice(0, selector.limit),
            };
          await delay(150, undefined, { signal });
        } while (Date.now() < deadline);
        throw new ToolError(
          "VERIFICATION_FAILED",
          "Final UI assertion did not pass",
        );
      },
    );
  }
  async deploy(
    target: string,
    artifact: string,
    app: { bundle_name: string; module?: string; ability: string },
    signal?: AbortSignal,
  ) {
    return this.store.lease(
      `device:${target}`,
      async () => {
        const captured = await captureFile(
          this.store,
          currentTrace().run_id ?? "deployment",
          artifact,
          undefined,
          signal,
        );
        const installed = await this.install(target, [captured], app, signal);
        return { ...installed, ...(await this.launch(target, app, signal)) };
      },
      signal,
    );
  }
  async install(
    target: string,
    artifacts: CapturedFile[],
    app: { bundle_name: string; module?: string; ability: string },
    signal?: AbortSignal,
  ) {
    const identity = await inspectApplicationPackages(
      artifacts.map((file) => file.path),
      app,
      signal,
    );
    return this.store.lease(
      `device:${target}`,
      async () => {
        // Recheck after waiting for the device lease, immediately before dispatch.
        for (const artifact of artifacts)
          await verifyCapturedFile(artifact, signal);
        const receipt =
          artifacts.length === 1
            ? await this.command(
                ["-t", target, "install", artifacts[0]!.path],
                signal,
                180000,
              )
            : await this.installBatch(target, artifacts, signal);
        invariant(
          !receipt.truncated &&
            /install bundle successfully/i.test(receipt.stdout) &&
            !/fail|error:/i.test(receipt.stdout + receipt.stderr),
          "INSTALL_UNCONFIRMED",
          "HDC did not confirm installation",
        );
        this.invalidate(target);
        return {
          installed: true,
          target,
          ...identity,
          packages: artifacts.map((artifact, index) => ({
            module: identity.modules[index]!.name,
            sha256: artifact.sha256,
            artifact_id: artifact.artifact_id,
          })),
          log: receipt.log,
        };
      },
      signal,
    );
  }
  private async installBatch(
    target: string,
    artifacts: CapturedFile[],
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    const remote = `/data/local/tmp/deveco-${crypto.randomUUID()}`;
    let uncertain = false,
      installing = false;
    try {
      await this.shell(target, ["mkdir", "-m", "700", remote], signal);
      for (const [index, file] of artifacts.entries()) {
        const transfer = await this.command(
          [
            "-t",
            target,
            "file",
            "send",
            file.path,
            `${remote}/${index}${path.extname(file.path)}`,
          ],
          signal,
          180000,
        );
        invariant(
          !transfer.truncated &&
            /FileTransfer finish/i.test(transfer.stdout) &&
            !/fail|error:/i.test(transfer.stdout + transfer.stderr),
          "PACKAGE_TRANSFER_UNCONFIRMED",
          "HDC did not confirm all package bytes reached the device",
        );
      }
      // One bm operation makes dependencies available together; passing multiple
      // host paths to hdc install would install them separately.
      installing = true;
      return await this.shell(
        target,
        ["bm", "install", "-p", remote],
        signal,
        180000,
      );
    } catch (error) {
      uncertain =
        installing ||
        (error instanceof ToolError && error.code === "CANCEL_UNCONFIRMED");
      throw error;
    } finally {
      // Do not remove inputs while a managed command may still be reading them.
      // Cleanup failure must not turn a confirmed installation into an unknown effect.
      if (uncertain)
        this.store.event(
          currentTrace().run_id ?? null,
          "device_package_cleanup_pending",
          { target, remote },
        );
      else {
        try {
          await this.shell(target, ["rm", "-rf", remote], undefined, 10000);
        } catch {
          this.store.event(
            currentTrace().run_id ?? null,
            "device_package_cleanup_pending",
            { target, remote },
          );
        }
      }
    }
  }
  async launch(
    target: string,
    raw: ApplicationTarget,
    signal?: AbortSignal,
    durable = false,
  ) {
    const result = await this.launchOperation(
      target,
      raw,
      signal,
      durable,
      false,
    );
    invariant(
      result,
      "LAUNCH_UNCONFIRMED",
      "Application launch has no completion receipt",
    );
    return result;
  }
  async reconcileLaunch(
    target: string,
    raw: ApplicationTarget,
    signal?: AbortSignal,
  ) {
    return this.launchOperation(target, raw, signal, true, true);
  }
  private async launchOperation(
    target: string,
    raw: ApplicationTarget,
    signal: AbortSignal | undefined,
    durable: boolean,
    recovery: boolean,
  ) {
    const app = appSchema.parse(raw);
    this.invalidate(target);
    const args = ["aa", "start", "-b", app.bundle_name, "-a", app.ability];
    if (app.module) args.push("-m", app.module);
    if (app.uri) args.push("-U", app.uri);
    if (app.action) args.push("-A", app.action);
    if (app.mime_type) args.push("-t", app.mime_type);
    for (const entity of app.entities ?? []) args.push("-e", entity);
    for (const [key, value] of Object.entries(app.parameters ?? {}).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      if (value === "") args.push("--psn", key);
      else
        args.push(
          typeof value === "boolean"
            ? "--pb"
            : typeof value === "number"
              ? "--pi"
              : "--ps",
          key,
          String(value),
        );
    }
    const accept = (receipt: DeviceReceipt) => {
      invariant(
        receipt.exitCode === 0 &&
          /start ability successfully/i.test(receipt.stdout),
        "LAUNCH_UNCONFIRMED",
        "The device did not acknowledge application launch",
      );
      return { accepted: true };
    };
    try {
      if (durable) {
        const receipt = await new DeviceEffectJournal(this.store, this).run(
          target,
          "launch",
          args,
          accept,
          signal,
          recovery,
        );
        if (receipt === undefined) return undefined;
      } else {
        const result = await this.shell(
          target,
          args,
          signal,
          30000,
          false,
          true,
        );
        invariant(
          !result.truncated,
          "LAUNCH_UNCONFIRMED",
          "Launch acknowledgement was truncated",
        );
        accept(result);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      const Failure =
        error instanceof SettledEffectError ? SettledEffectError : ToolError;
      throw new Failure(
        error instanceof ToolError ? error.code : "LAUNCH_FAILED",
        "Application launch failed; Want arguments and raw output are withheld",
      );
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = await this.shell(
        target,
        ["pidof", app.bundle_name],
        signal,
        10000,
        true,
      );
      if (/^\d+(?:\s+\d+)*\s*$/.test(state.stdout.trim()))
        return {
          started: true,
          processVerified: true,
          outcomeVerified: false,
          bundle_name: app.bundle_name,
          target,
        };
      await delay(200, undefined, { signal });
    }
    throw new SettledEffectError(
      "LAUNCH_NOT_RUNNING",
      "Application launch was accepted but its process was not found",
    );
  }
}
