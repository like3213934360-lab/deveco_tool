import cluster from "node:cluster";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { formatWithOptions } from "node:util";
import { z } from "zod";
import { buildRequest, bridgeEvent } from "./protocol.js";
import { BuildReceipts } from "./receipts.js";

// Own the SDK cluster worker directly. Do not run SDK master boot: it manages
// a shared registry and may terminate Java daemons belonging to other clients.
const sdkRoot = fs.realpathSync.native(z.string().min(1).parse(process.argv[2]));
if (cluster.isWorker) {
  const load = createRequire(import.meta.url);
  const entry = z
    .object({
      registryWorkerProcessListener: z.custom<() => void>(
        (value) => typeof value === "function",
      ),
    })
    .parse(
      load(
        path.join(
          sdkRoot,
          "src/base/daemon/cluster/worker-process-lifecycle.js",
        ),
      ) as unknown,
    );
  entry.registryWorkerProcessListener();
  process.send?.({ type: "native_ready" });
} else {
  const load = createRequire(import.meta.url);
  const workspace = z
    .object({
      getHvigorProjectHome: z.custom<() => unknown>(
        (value) => typeof value === "function",
      ),
    })
    .parse(load(path.join(sdkRoot, "src/cli/wrapper/util.js")) as unknown);
  const workspaceRoot = z
    .string()
    .min(1)
    .parse(workspace.getHvigorProjectHome());
  const installedEngine = fs.realpathSync.native(
    path.join(workspaceRoot, "node_modules/@ohos/hvigor"),
  );
  if (installedEngine !== sdkRoot)
    throw new Error(
      "Project Hvigor engine differs from the selected SDK; this protocol must be adapted and validated before use",
    );
  const parseLog = z
    .object({
      parse: z.custom<(text: string) => unknown>(
        (value) => typeof value === "function",
      ),
    })
    .parse(
      createRequire(import.meta.url)(
        path.join(sdkRoot, "node_modules/flatted"),
      ) as unknown,
    ).parse;
  const emit = (event: z.infer<typeof bridgeEvent>) => {
    if (!process.stdout.write(JSON.stringify(event) + "\n"))
      process.stdin.pause();
  };
  process.stdout.on("drain", () => process.stdin.resume());
  cluster.setupPrimary({
    exec: fileURLToPath(import.meta.url),
    args: [sdkRoot],
    execArgv: [],
    silent: true,
    windowsHide: true,
  });
  const worker = cluster.fork({
    _logLevel: "INFO",
    NODE_PATH: [path.join(workspaceRoot, "node_modules"), process.env.NODE_PATH]
      .filter(Boolean)
      .join(path.delimiter),
    WORKSPACE_DIR: workspaceRoot,
  });
  worker.process.stdout?.pipe(process.stderr, { end: false });
  worker.process.stderr?.pipe(process.stderr, { end: false });
  const receipts = new BuildReceipts();
  const recentLogs = new Set<string>();
  let ready = false;
  let stopping = false;
  const fatal = (message: string) => {
    if (stopping) return;
    stopping = true;
    emit({ type: "fatal", message: message.slice(0, 8192) });
    process.stdin.pause();
    worker.kill("SIGTERM");
  };
  const initialization = setTimeout(
    () => fatal("SDK worker initialization timed out"),
    20000,
  );
  worker.on("message", (raw: unknown) => {
    if (stopping) return;
    if (process.stderr.writableLength > 1048576)
      return fatal(
        "SDK log consumer is too slow; stopped at the 1 MiB bridge buffer limit",
      );
    const log = z
      .object({
        topic: z.literal("log4js:message"),
        data: z.string().max(1024 * 1024),
      })
      .safeParse(raw);
    if (log.success) {
      try {
        const fingerprint = crypto
          .createHash("sha256")
          .update(log.data.data)
          .digest("hex");
        if (recentLogs.has(fingerprint)) return;
        recentLogs.add(fingerprint);
        if (recentLogs.size > 128)
          recentLogs.delete(recentLogs.values().next().value!);
        const event = z
          .object({
            data: z.array(z.unknown()),
            level: z.object({ level: z.number() }),
          })
          .parse(parseLog(log.data.data));
        if (event.level.level < 20000) return;
        const text = formatWithOptions(
          { depth: 3, maxStringLength: 8192, maxArrayLength: 100 },
          ...event.data,
        ).slice(0, 65536);
        process.stderr.write(text + "\n");
      } catch {
        fatal("Malformed SDK logging event");
      }
      return;
    }
    const parsed = z
      .object({
        type: z.string(),
        content: z.unknown().optional(),
        workerId: z.number().optional(),
      })
      .safeParse(raw);
    if (!parsed.success) return fatal("Malformed SDK worker message");
    const message = parsed.data;
    try {
      if (message.type === "native_ready") {
        clearTimeout(initialization);
        ready = true;
        emit({ type: "ready", pid: worker.process.pid! });
      } else if (message.type === "NewWatchWorker") {
        receipts.watchWorker(message.workerId ?? 0);
      } else if (["WatchLog", "WatchCompileResult"].includes(message.type)) {
        if (message.content !== undefined)
          process.stderr.write(
            formatWithOptions(
              { depth: 4, maxStringLength: 8192, maxArrayLength: 100 },
              message.content,
            ).slice(0, 65536) + "\n",
          );
      } else if (
        ["cluster_finished", "cluster_failed"].includes(message.type)
      ) {
        const result = receipts.complete(
          message.type === "cluster_finished",
          typeof message.content === "string" ? message.content : undefined,
        );
        if (result) emit(result);
      }
    } catch (error) {
      fatal(error instanceof Error ? error.message : String(error));
    }
  });
  worker.on("error", (error) => fatal(error.message));
  worker.on("exit", (code, signal) => {
    clearTimeout(initialization);
    if (!stopping)
      emit({ type: "fatal", message: `SDK worker exited (${signal ?? code})` });
    // No implicit restart: configuration changes or a lost worker invalidate its baseline.
    process.exitCode = stopping ? 0 : 1;
    process.stdin.destroy();
  });
  let pending = Buffer.alloc(0);
  process.stdin.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > 65536) return fatal("Build request exceeds 64 KiB");
    for (;;) {
      const end = pending.indexOf(10);
      if (end < 0) break;
      const line = pending.subarray(0, end).toString("utf8");
      pending = pending.subarray(end + 1);
      try {
        const request = buildRequest.parse(JSON.parse(line) as unknown);
        if (!ready || receipts.busy)
          return fatal("SDK worker is not ready for another request");
        receipts.begin(request.id, request.options);
        worker.send(
          { type: "CommonBuild", content: request.options },
          (error: Error | null) => {
            if (error) fatal(error.message);
          },
        );
      } catch (error) {
        fatal(error instanceof Error ? error.message : String(error));
      }
    }
  });
  process.stdin.on("end", () => fatal("Runtime input closed"));
  // ProcessService owns the entire process group and confirms its disappearance.
  // Keep the primary alive until the worker exits so its children are reaped.
  process.on("SIGTERM", () => {
    stopping = true;
    worker.kill("SIGTERM");
  });
}
