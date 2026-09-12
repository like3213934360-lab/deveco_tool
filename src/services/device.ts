import fs from "node:fs";
import { z } from "zod";
import path from "node:path";
import crypto from "node:crypto";
import {
  selectorSchema,
  controlSchema,
  type Selector,
  appSchema,
  startupCheckSchema,
  type ApplicationTarget,
} from "../core/contracts.js";
export {
  selectorSchema,
  controlSchema,
  type Selector,
} from "../core/contracts.js";
import { setTimeout as delay } from "node:timers/promises";
import { invariant, SettledEffectError, ToolError, errorResult } from "../core/errors.js";
import { ProcessService, type ProcessResult } from "../core/process.js";
import { discoverToolchain, toolCommand } from "../core/toolchain.js";
import { StateStore } from "../core/store.js";
import { digest, privateDirectory } from "../core/files.js";
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
import { checkStartup, inspectStartupFrame, type StartupReport } from "./startup-check.js";
import { UiTestLogService, type UiLogAnchor } from "./ui-test-log.js";
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
type InstallReceipt = Pick<
  ProcessResult,
  "exitCode" | "stdout" | "stderr" | "truncated" | "log"
>;
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
    readonly assertTaskTarget: (target: string) => void = () => {},
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
  screenshot(target: string, input: unknown = {}, signal?: AbortSignal, progressScope?: readonly Rect[]) {
    return this.screenshots.capture(target, input, signal, progressScope);
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
        this.assertTaskTarget(target);
        const resolved = await this.store.privateMemo("control", { target, input }, async () => {
          let snapshot: Snapshot | undefined;
          if (needsControlSnapshot(input)) {
            snapshot = captured ?? (await this.snapshot(target, signal));
            invariant(snapshot.device === target && Date.now() - snapshot.created <= 30000 &&
              (!captured || this.snapshots.get(captured.id) === captured),
              "SNAPSHOT_EXPIRED", "The prepared control snapshot is no longer available");
          }
          return resolveControl(input, snapshot);
        }, (value) => controlSchema.parse(value));
        const args = uiInputArguments(resolved);
        this.invalidate(target);
        if (resolved.action.startsWith("mouse")) {
          const { mouseRequest } = await import("./ui-control.js"), { nativeDriverCall } = await import("./text.js");
          const request = mouseRequest(resolved), decode = (raw: unknown) => z.object({ method: z.string(), commandAccepted: z.boolean(), outcomeVerified: z.boolean() }).parse(raw);
          return this.store.privateEffect("mouse", { target, input, resolved }, () => nativeDriverCall(this, target, request.api, request.args, signal), decode);
        }
        if (resolved.action === "text") {
          // Some released UiTest versions print valid usage but exit 1 for help.
          // Only this read-only probe accepts that status; input still requires exit 0.
          const help = await this.shell(target, ["uitest", "uiInput", "help"], signal, 30000, true);
          invariant([0, 1].includes(help.exitCode ?? -1) && !help.truncated && !help.stderr.trim() && /^text\s+<text>/m.test(help.stdout), "UI_FOCUSED_TEXT_UNSUPPORTED", "Installed UiTest does not advertise current-focus text input");
          return this.store.privateEffect("focused-text", { target, input, resolved }, async () => {
            const receipt = await this.shell(target, ["uitest", "uiInput", ...args], signal, 30000, false, true);
            invariant(receipt.exitCode === 0 && !receipt.stderr.trim() && ["", "No Error"].includes(receipt.stdout.trim()), "UI_TEXT_UNCONFIRMED", "Native focused text input did not return a successful receipt; inspect the field before retrying");
            return { method: "uitest-current-focus", commandAccepted: true, outcomeVerified: false };
          }, raw => z.object({ method: z.string(), commandAccepted: z.boolean(), outcomeVerified: z.boolean() }).parse(raw));
        }
        if (resolved.action === "inputText") {
          const { pasteText } = await import("./text.js");
          const resultSchema = z.object({ method: z.string(), commandAccepted: z.boolean(), outcomeVerified: z.boolean() });
          return this.store.privateEffect("paste", { target, input, resolved }, () => pasteText(
            this, target, { x: resolved.x!, y: resolved.y!,
              ...(resolved.display_id === undefined ? {} : { displayId: resolved.display_id }) }, resolved.text!, signal),
            (value) => resultSchema.parse(value), async () => {
              // Only an explicit, stable field identity can establish the desired text after a lost RPC reply.
              const selector = input.selector;
              if (!selector || !(selector.key && selector.bundle_name)) return undefined;
              const nodes = (await this.snapshot(target, signal)).query.select({ ...selector, text: undefined, value: undefined, limit: 2 });
              const node = nodes.length === 1 ? nodes[0] : undefined;
              if (!node || !/TextInput|TextArea|Search/.test(node.type ?? "") ||
                (node.text !== resolved.text && node.value !== resolved.text)) return undefined;
              return { method: "recovered-field-value", commandAccepted: false, outcomeVerified: true };
            });
        }
        const accept = (result: DeviceReceipt & { stderr?: string }) => {
          const receipt = result.stdout.trim();
          invariant(result.exitCode === 0 && !(result.stderr ?? "").trim() && (receipt === "" || receipt === "No Error"),
            "UI_ACTION_FAILED", result.stdout + (result.stderr ?? ""));
          return { commandAccepted: true, outcomeVerified: false };
        };
        const trace = currentTrace();
        if (trace.run_id && trace.node) {
          const result = await new DeviceEffectJournal(this.store, this).run(target, "control", ["uitest", "uiInput", ...args], accept, signal);
          invariant(result, "UI_ACTION_UNCONFIRMED", "UI operation has no complete receipt");
          return result;
        }
        return accept(await this.shell(target, ["uitest", "uiInput", ...args], signal));
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
    artifacts: readonly string[],
    app: { bundle_name: string; module?: string; ability: string },
    signal?: AbortSignal,
  ) {
    return this.store.lease(
      `device:${target}`,
      async () => {
        invariant(artifacts.length > 0 && artifacts.length <= 64,
          "PACKAGE_COUNT_INVALID", "Provide between 1 and 64 application packages");
        const captured: CapturedFile[] = [];
        for (const artifact of artifacts) captured.push(await captureFile(
          this.store, currentTrace().run_id ?? "deployment", artifact, undefined, signal,
        ));
        const installed = await this.install(target, captured, app, signal);
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
    durable = false,
  ) {
    const result = await this.installOperation(
      target,
      artifacts,
      app,
      signal,
      durable,
      false,
    );
    invariant(
      result,
      "INSTALL_UNCONFIRMED",
      "Installation has no completion receipt",
    );
    return result;
  }
  async reconcileInstall(
    target: string,
    artifacts: CapturedFile[],
    app: { bundle_name: string; module?: string; ability: string },
    signal?: AbortSignal,
  ) {
    return this.installOperation(target, artifacts, app, signal, true, true);
  }
  private async installOperation(
    target: string,
    artifacts: CapturedFile[],
    app: { bundle_name: string; module?: string; ability: string },
    signal: AbortSignal | undefined,
    durable: boolean,
    recovery: boolean,
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
        this.assertTaskTarget(target);
        for (const artifact of artifacts)
          await verifyCapturedFile(artifact, signal);
        const receipt =
          artifacts.length === 1 && !durable
            ? await this.command(
                ["-t", target, "install", artifacts[0]!.path],
                signal,
                180000,
              )
            : await this.installBatch(
                target,
                artifacts,
                signal,
                durable,
                recovery,
              );
        if (receipt === undefined) return undefined;
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
    durable = false,
    recovery = false,
  ): Promise<InstallReceipt | undefined> {
    const trace = currentTrace();
    invariant(
      !durable || (trace.run_id && trace.node),
      "DEVICE_EFFECT_CONTEXT",
      "Durable installation requires a workflow node",
    );
    const remote = durable
      ? `/data/local/tmp/deveco-packages-${digest({
          state: this.store.root,
          run_id: trace.run_id,
          node: trace.node,
          target,
          packages: artifacts.map((file) => ({
            sha256: file.sha256,
            bytes: file.bytes,
            extension: path.extname(file.path),
          })),
        })}`
      : `/data/local/tmp/deveco-${crypto.randomUUID()}`;
    const remoteFiles = artifacts.map(
      (file, index) => `${remote}/${index}${path.extname(file.path)}`,
    );
    let uncertain = false,
      installing = false;
    try {
      const dispatched = durable && this.store.operationState(trace.run_id!, `${trace.node}:device:install`) !== undefined;
      if (!dispatched) {
        // The private staging directory is repeatable only before bm dispatch.
        // A durable install intent always takes the receipt path, never uploads again.
        await this.shell(target, ["sh", "-c", `test ! -L '${remote}' && { test -d '${remote}' || mkdir -m 700 '${remote}'; }`], signal);
        for (const [index, file] of artifacts.entries()) {
          const transfer = await this.command(
            ["-t", target, "file", "send", file.path, remoteFiles[index]!],
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
        if (durable) {
          const hashes = await this.shell(
            target,
            ["sha256sum", ...remoteFiles],
            signal,
          );
          const lines = hashes.stdout.trim().split(/\r?\n/);
          invariant(
            !hashes.truncated &&
              lines.length === artifacts.length &&
              lines.every((line, index) => {
                const match = /^([a-fA-F0-9]{64})[ \t]+\*?(.+)$/.exec(line);
                return (
                  match?.[1]?.toLowerCase() === artifacts[index]!.sha256 &&
                  match[2] === remoteFiles[index]
                );
              }),
            "PACKAGE_TRANSFER_CHANGED",
            "Device package hashes do not match the captured deployment inputs",
          );
        }
      }
      // One bm operation makes dependencies available together; passing multiple
      // host paths to hdc install would install them separately.
      installing = true;
      if (durable) {
        const result = await new DeviceEffectJournal(this.store, this).run(
          target,
          "install",
          ["bm", "install", "-p", remote],
          (receipt): InstallReceipt => {
            invariant(
              receipt.exitCode === 0 &&
                /install bundle successfully/i.test(receipt.stdout) &&
                !/fail|error:/i.test(receipt.stdout),
              "INSTALL_UNCONFIRMED",
              "The device did not acknowledge installation of the captured package set",
            );
            return {
              exitCode: 0,
              stdout: "install bundle successfully",
              stderr: "",
              truncated: false,
            };
          },
          signal,
          false,
          180000,
        );
        uncertain = result === undefined;
        return result;
      }
      return await this.shell(
        target,
        ["bm", "install", "-p", remote],
        signal,
        180000,
      );
    } catch (error) {
      uncertain =
        (!(error instanceof SettledEffectError) && installing) ||
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
  async stopApplication(target: string, bundle: string, signal?: AbortSignal) {
    return this.store.lease(`device:${target}`, () => this.stopApplicationLocked(target, bundle, signal), signal);
  }
  private async stopApplicationLocked(target: string, bundle: string, signal?: AbortSignal) {
    this.assertTaskTarget(target);
    const args = ["aa", "force-stop", bundle];
    const accept = (result: DeviceReceipt & { stderr?: string }) => {
      invariant(result.exitCode === 0 && !/error|failed/i.test(result.stdout + (result.stderr ?? "")), "APP_STOP_FAILED", "Device did not confirm application stop");
      this.invalidate(target);
      return { stopped: true };
    };
    const trace = currentTrace();
    if (trace.run_id && trace.node) {
      const result = await new DeviceEffectJournal(this.store, this).run(target, "stop", args, accept, signal);
      invariant(result, "APP_STOP_UNCONFIRMED", "Application stop has no completion receipt");
      return result;
    }
    return accept(await this.shell(target, args, signal));
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
    return this.store.lease(`device:${target}`, () => this.launchLocked(target, raw, signal, durable, recovery), signal);
  }
  private async launchLocked(
    target: string,
    raw: ApplicationTarget,
    signal: AbortSignal | undefined,
    durable: boolean,
    recovery: boolean,
  ) {
    this.assertTaskTarget(target);
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
      if (/Error Code:\s*10106102\b/.test(receipt.stdout))
        throw new ToolError("APP_DEVICE_LOCKED", "Unlock the selected device before launching the application");
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
        error instanceof ToolError && error.code === "APP_DEVICE_LOCKED"
          ? "Unlock the selected device before launching the application"
          : "Application launch failed; Want arguments and raw output are withheld",
      );
    }
    const startup_check = await this.checkStartup(target, app, signal);
    return {
      started: true,
      commandAccepted: true,
      processVerified: true,
      startupVerified: true,
      outcomeVerified: false,
      startup_check,
      bundle_name: app.bundle_name,
      target,
    };
  }

  async checkStartup(target: string, app: ApplicationTarget, signal?: AbortSignal, expectedPids?: readonly string[]) {
    const policy = startupCheckSchema.parse(app.startup_check ?? {});
    let entered = false;
    const observe = async () => {
      entered = true;
      const began = performance.now(), started_at = new Date().toISOString();
      let report: StartupReport | undefined;
      let anchor: UiLogAnchor | undefined;
      const logs = new UiTestLogService(this.store, this);
      const run = currentTrace().run_id ?? "startup";
      let evidence: { artifact_id: string; bytes: number; mime: string } | undefined;
      let failure: unknown;
      try {
        await withinDeadline(policy.timeout_ms, signal, "STARTUP_TIMEOUT", async (bounded) => {
          // A log anchor failure never prevents process observation. The final
          // report states that diagnostic logs are unavailable in that case.
          anchor = await withinDeadline(Math.min(1000, policy.timeout_ms / 4), bounded, "STARTUP_LOG_ANCHOR_TIMEOUT",
            scope => logs.anchor(target, app.bundle_name, scope)).catch(() => undefined);
          bounded.throwIfAborted();
          report = await checkStartup({
            pids: async (scope) => {
              const result = await this.shell(target, ["pidof", app.bundle_name], scope, 3000, true, true);
              invariant(!result.truncated && !result.stderr.trim() && [0, 1].includes(result.exitCode) &&
                (!result.stdout.trim() || /^\d+(?:\s+\d+)*$/.test(result.stdout.trim())),
              "STARTUP_PID_UNAVAILABLE", "Device did not return a reliable process observation");
              return result.stdout.trim() ? result.stdout.trim().split(/\s+/) : [];
            },
            frame: async (scope) => {
              const snapshot = await this.snapshot(target, scope);
              const windows = snapshot.nodes.filter(node => node.bundleName === app.bundle_name && isWindowSurface(node) && node.visible !== false && node.rect);
              const displays = new Set(windows.map(node => node.displayId));
              const display = policy.display_id ?? (displays.size === 1 && /^\d+$/.test(windows[0]?.displayId ?? "") ? Number(windows[0]!.displayId) : undefined);
              invariant(display !== undefined, "STARTUP_SCREEN_SCOPE_UNAVAILABLE", "Select an observed application display before startup image inspection");
              const scoped = windows.filter(node => node.displayId === String(display));
              invariant(scoped.length > 0 && scoped.length <= 32, "STARTUP_SCREEN_SCOPE_UNAVAILABLE", "No bounded visible application window on this display");
              const frame = await this.screenshot(target, { format: "jpeg", width: 720, display_id: display }, scope);
              invariant(frame.artifact, "STARTUP_FRAME_UNAVAILABLE", "Startup screenshot requires a retained artifact");
              const pixels = this.store.readBinaryArtifact(frame.artifact.artifact_id, 4 * 1024 * 1024, ["image/jpeg"]);
              return {
                artifact_id: frame.artifact.artifact_id, sha256: frame.sha256,
                ...inspectStartupFrame(pixels.data, { width: frame.native_width, height: frame.native_height }, scoped.map(node => node.rect!)),
              };
            },
          }, policy, bounded, expectedPids);
        });
      } catch (error) {
        failure = error;
        // Cancellation can happen before the first PID sample, including while
        // obtaining diagnostic metadata. Even then retain a truthful report.
        report ??= {
          format: 1, status: "inconclusive", reason: "Startup observation did not begin",
          started_at, finished_at: new Date().toISOString(), elapsed_ms: Math.max(0, performance.now() - began),
          policy, process: "unverified", screen: policy.mode === "process_only" ? "not_applicable" : "unavailable",
          business_outcome_verified: false, process_samples: [], frames: [],
        };
        report = { ...report, status: signal?.aborted ? "cancelled" : "inconclusive",
          reason: signal?.aborted ? "Startup observation was interrupted; the accepted launch must not be replayed blindly"
            : `Startup observation did not complete (${errorResult(error).code})` };
      } finally {
        if (report) {
          // Bounded logs are diagnostics, not a claim of continuous capture.
          // A separate short cleanup deadline cannot keep a cancelled launch alive.
          let log: unknown = { complete: false, status: "unavailable", reason: "No reliable log anchor" };
          if (anchor) try {
            log = await withinDeadline(3000, signal, "STARTUP_LOG_TIMEOUT", scope => logs.capture(target, app.bundle_name, anchor, 0, "startup", "post-launch", scope));
          } catch { log = { complete: false, status: "unavailable", reason: "Diagnostic capture interrupted or unavailable" }; }
          evidence = this.store.artifact(run, JSON.stringify({ target, bundle_name: app.bundle_name, ...report, diagnostic_log: log }), "application/json");
        }
      }
      if (failure) {
        const reason = errorResult(failure);
        throw new SettledEffectError(reason.code, report!.reason, {
          commandAccepted: true, startupVerified: false, outcomeVerified: false,
          report, evidence,
        });
      }
      invariant(report && evidence, "STARTUP_UNVERIFIED", "Startup observation did not produce a final report");
      if (report.status !== "passed") throw new SettledEffectError(
        report.status === "failed" ? "STARTUP_PROCESS_FAILED" : "STARTUP_UNVERIFIED",
        report.reason, { commandAccepted: true, startupVerified: false, outcomeVerified: false, report, evidence },
      );
      return { ...report, evidence };
    };
    try {
      return await this.store.lease(`device:${target}`, observe, signal);
    } catch (error) {
      // A confirmed launch can be cancelled while its remote receipt is being
      // cleaned up, before this nested lease begins. An already-aborted
      // observation performs no device IO: it only persists the settled,
      // unverified startup report so the outer effect is not left uncertain.
      if (!entered && signal?.aborted) return observe();
      throw error;
    }
  }
}
