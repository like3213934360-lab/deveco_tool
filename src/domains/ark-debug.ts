import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { errorResult, invariant, ToolError } from "../core/errors.js";
import { run } from "../core/proc.js";
import { pool } from "../core/sessions.js";
import { toolCommand } from "../core/toolchain.js";
import { deviceSummary, forceStop, hdc, install, pidOf, resolveTarget, shell } from "./device.js";
import { buildOutputs, buildProject, inspectProject, mainAbility, runnableDeviceTypes, selectRunModules, type Project } from "./project.js";
import { locate, mapBreakpoint } from "./sourcemap.js";
import { evaluateCondition, memberPath, parseCondition, type Primitive } from "./debug-condition.js";

export const debugOps = ["attach", "status", "stop", "threads", "pause", "resume", "step_into", "step_over", "step_out", "stack", "vars", "eval", "set", "break_add", "break_remove", "break_list", "break_enable", "break_disable", "events"] as const;
type DebugOp = (typeof debugOps)[number];
type Json = Record<string, unknown>;
type LogLevel = "debug" | "info" | "warn" | "error";
interface Frame { callFrameId: string; functionName?: string; url?: string; location?: Json; scopeChain?: { type: string; object?: { objectId?: string } }[] }
interface Pause { reason?: string; callFrames: Frame[] }
interface Packet { id?: number; method?: string; result?: Json; params?: Json; error?: Json }
interface Breakpoint extends Json {
  breakpointId: string; vmId: string; url: string; lineNumber: number; columnNumber: number; locations: { lineNumber: number }[];
  file: string; requested_line: number; enabled: boolean; hits: number; hit_count?: string; condition?: string;
  log?: string; log_expression?: string; level?: LogLevel;
}
interface Request {
  op: DebugOp; session_id?: string; file?: string; line?: number; column?: number; query?: string; symbol?: string; text?: string; frame?: number; thread?: number; limit?: number;
  wait?: number; hit_count?: string; disabled?: boolean;
  all?: boolean; break_kind?: "breakpoint" | "logpoint" | "all";
  bundle?: string; pid?: number; module?: string; output_path?: string; log_level?: LogLevel; log_expression?: string;
}
interface WorkerChannel { id: number; tid: number; name: string; ready: Promise<void>; channel?: Debugger; connected?: boolean; error?: ReturnType<typeof errorResult> }
type DebugEvent = { id: number; event: string; at: number; detail: Json };
const maxEventLog = 16 * 1024 * 1024;

function validateEventLog(file: string) {
  invariant(path.isAbsolute(file) && fs.statSync(path.dirname(file), { throwIfNoEntry: false })?.isDirectory(),
    "INVALID_INPUT", "Debug output_path must be absolute with an existing parent directory");
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  invariant(!stat || stat.isFile() && stat.size < maxEventLog, "CONFLICT", "Debug output_path requires a regular file below 16 MiB", { file });
  if (!stat) return;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    invariant(opened.isFile() && opened.dev === stat.dev && opened.ino === stat.ino && opened.size === stat.size,
      "CONFLICT", "Debug output_path changed before inspection", { file });
    const bytes = Buffer.alloc(stat.size);
    invariant(fs.readSync(fd, bytes, 0, stat.size, 0) === stat.size && bytes.at(-1) === 10,
      "CONFLICT", "Choose a new file or an existing complete ArkTS event log", { file });
    try {
      for (const line of new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, -1)).split("\n")) {
        const event = JSON.parse(line) as Partial<DebugEvent> & { session_id?: string; thread?: number } | null;
        invariant(event && typeof event.session_id === "string" && event.session_id.startsWith("ark_") &&
          typeof event.event === "string" && Number.isInteger(event.thread) && Number.isInteger(event.id) && Number.isInteger(event.at),
          "CONFLICT", "Existing NDJSON contains a record outside the ArkTS event format");
      }
    } catch (error) { throw new ToolError("CONFLICT", "Existing debug log contains invalid NDJSON", { file, cause: errorResult(error).message }); }
    return stat;
  } finally { fs.closeSync(fd); }
}

class EventLog {
  private fd: number | undefined;
  private count = 0;
  private bytes = 0;
  private error?: ReturnType<typeof errorResult>;

  constructor(readonly file: string) {
    const prior = validateEventLog(file);
    if (!prior) {
      this.fd = fs.openSync(file, "wx", 0o600);
      return;
    }
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(fd);
      invariant(opened.isFile() && opened.dev === prior.dev && opened.ino === prior.ino && opened.size === prior.size,
        "CONFLICT", "Existing event log changed before attachment", { file });
      this.fd = fd;
      this.bytes = prior.size;
    } catch (error) { fs.closeSync(fd); throw error; }
  }

  append(event: DebugEvent, session_id: string, thread: number) {
    if (this.error || this.fd === undefined) return;
    try {
      const line = Buffer.from(JSON.stringify({ session_id, thread, ...event }) + "\n");
      invariant(this.bytes + line.length <= maxEventLog, "DEBUG_LOG_FAILED", "Debug log reached its 16 MiB limit");
      invariant(fs.fstatSync(this.fd).size === this.bytes, "DEBUG_LOG_FAILED", "Another writer changed the event log", { file: this.file });
      fs.writeFileSync(this.fd, line);
      this.bytes += line.length;
      this.count++;
    } catch (error) { this.error = errorResult(error); }
  }

  close() {
    if (this.fd === undefined) return;
    const fd = this.fd;
    this.fd = undefined;
    try {
      try {
        fs.fsyncSync(fd);
        const opened = fs.fstatSync(fd), saved = fs.lstatSync(this.file, { throwIfNoEntry: false });
        invariant(saved?.isFile() && saved.dev === opened.dev && saved.ino === opened.ino && saved.size === this.bytes,
          "DEBUG_LOG_FAILED", "Event log changed on disk before it was closed", { file: this.file });
      } finally { fs.closeSync(fd); }
    }
    catch (error) { this.error ??= errorResult(error); }
  }

  status() { return { path: this.file, events_written: this.count, bytes: this.bytes, complete: this.fd === undefined && !this.error, ...(this.error && { error: this.error }) }; }
}

const poolById = pool<Debugger>(4);
const open = new Map<string, Debugger>();

function primitiveValue(result: Json) {
  if (Object.hasOwn(result, "value")) return result.value;
  if (result.type === "string" && typeof result.unserializableValue === "string") return result.unserializableValue;
  if (result.type === "number" && typeof result.unserializableValue === "string" && result.unserializableValue.trim() && Number.isFinite(Number(result.unserializableValue))) return Number(result.unserializableValue);
  if (result.type === "boolean" && ["true", "false"].includes(String(result.unserializableValue))) return result.unserializableValue === "true";
  if (result.subtype === "null") return null;
  return undefined;
}

function hitCountMatches(spec: string | undefined, hits: number) {
  if (!spec) return true;
  const match = /^(>=|<=|=|%)?([1-9][0-9]{0,6})$/.exec(spec);
  invariant(match, "INVALID_INPUT", "hit_count accepts N, =N, >=N, <=N or %N");
  const count = Number(match[2]);
  return match[1] === ">=" ? hits >= count : match[1] === "<=" ? hits <= count : match[1] === "%" ? hits % count === 0 : hits === count;
}

export function debugTarget(id: string) {
  const session = open.get(id);
  invariant(session, "NOT_FOUND", "ArkTS debug session is unavailable in this MCP process", { session_id: id });
  return session.target;
}

async function localPort() {
  const reservation = net.createServer();
  await new Promise<void>((resolve, reject) => reservation.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = reservation.address() as net.AddressInfo;
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function installForward(target: string, port: number, remote: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await hdc(["-t", target, "fport", `tcp:${port}`, remote], undefined, 5000, true);
  invariant(result.code === 0 && /Forwardport result:OK/.test(result.stdout), "DEBUG_ATTACH_FAILED", "HDC could not forward an ArkTS channel", { remote });
}

async function removeForward(target: string, port: number, remote: string) {
  const local = `tcp:${port}`, result = await hdc(["-t", target, "fport", "rm", local, remote], undefined, 4000, true);
  if (result.code === 0 && /Remove forward ruler success/.test(result.stdout)) return;
  const table = await hdc(["-t", target, "fport", "ls"], undefined, 4000, true);
  const rows = table.stdout.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/));
  const readable = table.code === 0 && !table.truncated && (table.stdout.trim() === "[Empty]" || rows.every((row) => row.length === 4 && /^\[(?:Forward|Reverse)\]$/.test(row[3]!)));
  invariant(readable && !rows.some((row) => row[0] === target && row[1] === local && row[2] === remote),
    "DEVICE_CLEANUP_FAILED", "Could not verify removal of the Ark debugger forward", { port, remote });
}

class Debugger {
  private socket?: WebSocket;
  private forward = false;
  private attached = false;
  private closing = false;
  private response?: { id: number; settle: (error?: unknown, result?: Json) => void };
  private nextId = 0;
  private lastEvent = 0;
  private pause?: Pause;
  private events: DebugEvent[] = [];
  private scripts = new Map<string, string>();
  private breakpoints = new Map<string, Breakpoint>();
  private breakpointWork?: Promise<void>;
  private lifetime = new AbortController();
  private releaseStartup = false;
  private broker?: { port: number; remote: string; socket: WebSocket };
  private workers = new Map<number, WorkerChannel>();

  constructor(readonly id: string, readonly target: string, readonly bundle: string, private readonly pid: number, private readonly port: number,
    private readonly project?: Project, private readonly instance = 0, private readonly eventLog?: EventLog) {}
  private get remote() { return `ark:${this.pid}@${this.instance ? `${this.instance}@` : ""}Debugger`; }

  async connect(signal: AbortSignal, started = false, stopAtEntry = false) {
    // Some running apps report an entry pause later, when they first create a Worker.
    this.releaseStartup = !stopAtEntry;
    if (!started && !this.instance) {
      signal.throwIfAborted();
      const attach = await shell(this.target, ["aa", "attach", "-b", this.bundle], undefined, 10000);
      invariant(attach.code === 0 && /attach app debug successfully/i.test(attach.stdout + attach.stderr), "DEBUG_ATTACH_FAILED", "Ability Manager rejected ArkTS attach");
      this.attached = true;
      await waitForDebugPid(this.target, this.bundle, { pid: this.pid, signal });
    }
    this.attached = this.instance === 0;
    await installForward(this.target, this.port, this.remote, signal);
    this.forward = true;
    const deadline = Date.now() + 3000;
    for (;;) {
      try { await this.openSocket(signal); break; }
      catch (error) {
        signal.throwIfAborted();
        // Connection refusal occurs before a TCP connection and cannot consume the VM's one-shot WebSocket.
        if ((error as NodeJS.ErrnoException).code !== "ECONNREFUSED" || Date.now() >= deadline)
          throw new ToolError("DEBUG_ATTACH_FAILED", "The ArkTS WebSocket handshake failed", { cause: errorResult(error) });
        await delay(100, undefined, { signal });
      }
    }
    await this.call("Runtime.enable", {}, signal);
    await this.call("Debugger.enable", { maxScriptsCacheSize: 10000000 }, signal);
    await this.call("Runtime.runIfWaitingForDebugger", {}, signal);
    if (started && stopAtEntry) {
      const deadline = Date.now() + 10000;
      while (!this.pause && Date.now() < deadline) await delay(50, undefined, { signal });
      invariant(this.pause, "EVIDENCE_MISSING", "The debugger has not reported an entry pause");
    } else if (started) {
      await delay(300, undefined, { signal });
      await this.breakpointWork;
      invariant(!this.pause, "EVIDENCE_MISSING", "The Ark VM is paused after debug startup", { reason: this.pause?.reason });
    }
  }

  private async openSocket(signal: AbortSignal) {
    signal.throwIfAborted();
    let opened = false;
    const socket = this.socket = new WebSocket(`ws://127.0.0.1:${this.port}`, { perMessageDeflate: false, handshakeTimeout: 10000, maxPayload: 8 * 1024 * 1024 });
    const disconnected = (error: Error) => {
      if (!opened || socket !== this.socket) return;
      this.response?.settle(new ToolError("DEBUG_DISCONNECTED", "ArkTS debug connection closed", { cause: error.message }));
      if (!this.closing && poolById.has(this.id)) void poolById.closeIf(this.id, this);
    };
    socket.on("error", disconnected);
    socket.on("close", () => disconnected(new Error("WebSocket closed")));
    socket.on("message", (data) => {
      try { this.receive(JSON.parse(data.toString()) as Packet); }
      catch (error) { disconnected(new Error("Invalid ArkTS debugger frame", { cause: error })); socket.terminate(); }
    });
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { opened = true; cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); socket.terminate(); reject(error); };
      const aborted = () => { cleanup(); socket.terminate(); reject(signal.reason); };
      const closed = () => failed(new Error("WebSocket closed"));
      const cleanup = () => { socket.off("open", onOpen); socket.off("error", failed); socket.off("close", closed); signal.removeEventListener("abort", aborted); };
      socket.once("open", onOpen); socket.once("error", failed); socket.once("close", closed);
      if (signal.aborted) aborted(); else signal.addEventListener("abort", aborted, { once: true });
    });
  }

  private async connectBroker(signal: AbortSignal) {
    invariant(!this.instance, "INVALID_INPUT", "Worker discovery belongs to the main session");
    if (this.broker) {
      invariant(this.broker.socket.readyState === WebSocket.OPEN, "DEBUG_DISCONNECTED", "Worker discovery disconnected; stop the session before reconnecting");
      return;
    }
    const port = await localPort(), remote = `ark:${this.pid}@${this.bundle}`;
    await installForward(this.target, port, remote, signal);
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { perMessageDeflate: false, handshakeTimeout: 5000, maxPayload: 128 * 1024 });
    this.broker = { port, remote, socket };
    socket.on("error", (error) => this.log("Debugger.threadError", { error: errorResult(error) }));
    socket.on("message", (bytes) => {
      try { this.workerMessage(JSON.parse(bytes.toString()) as Json); }
      catch (error) { this.log("Debugger.threadError", { error: errorResult(error) }); }
    });
    try {
      await once(socket, "open", { signal: AbortSignal.any([signal, AbortSignal.timeout(5500)]) });
      await new Promise<void>((resolve, reject) => socket.send(JSON.stringify({ type: "connected" }), (error) => error ? reject(error) : resolve()));
    } catch (error) {
      socket.terminate();
      try { await removeForward(this.target, port, remote); this.broker = undefined; }
      catch (cleanup) { throw new ToolError("DEVICE_CLEANUP_FAILED", "Worker discovery failed and its forward remains", { error: errorResult(error), cleanup: errorResult(cleanup) }); }
      throw error;
    }
  }

  private workerMessage(message: Json) {
    if (this.closing || (message.type !== "addInstance" && message.type !== "destroyInstance")) return;
    const id = message.instanceId;
    invariant(typeof id === "number" && Number.isSafeInteger(id) && id >= 0, "DEBUG_PROTOCOL_ERROR", "Invalid Ark worker identity");
    if (id === 0) return;
    const current = this.workers.get(id);
    if (message.type === "destroyInstance") {
      if (current) current.ready = current.ready.then(async () => {
        await current.channel?.close();
        this.workers.delete(id);
        this.log("Debugger.threadDestroyed", { thread: id });
      }).catch((error) => { current.error = errorResult(error); this.log("Debugger.threadError", { thread: id, error: current.error }); });
      return;
    }
    if (current) return;
    invariant(this.workers.size < 16 && typeof message.tid === "number" && Number.isSafeInteger(message.tid) && typeof message.name === "string",
      "DEBUG_PROTOCOL_ERROR", "Invalid or excessive Ark worker instances");
    const worker: WorkerChannel = { id, tid: message.tid, name: message.name, ready: Promise.resolve() };
    this.workers.set(id, worker);
    worker.ready = this.connectWorker(worker);
  }

  private async connectWorker(worker: WorkerChannel) {
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(20000)]);
    try {
      const port = await localPort();
      signal.throwIfAborted();
      const channel = worker.channel = new Debugger(this.id, this.target, this.bundle, this.pid, port, this.project, worker.id, this.eventLog);
      await channel.connect(signal, true);
      worker.connected = true;
      this.log("Debugger.threadAttached", { thread: worker.id, tid: worker.tid, name: worker.name });
    } catch (error) {
      worker.error = errorResult(error);
      this.log("Debugger.threadError", { thread: worker.id, error: worker.error });
      try { await worker.channel?.close(); worker.channel = undefined; }
      catch (cleanup) { this.log("Debugger.threadError", { thread: worker.id, error: errorResult(cleanup) }); }
    }
  }

  private receive(message: Packet) {
    if (message.id !== undefined) {
      const pending = this.response;
      if (pending?.id === message.id) pending.settle(message.error && new ToolError("DEBUG_PROTOCOL_ERROR", "The Ark VM rejected the operation", message.error), message.result);
      return;
    }
    const params = message.params ?? {};
    let detail: Json = params;
    switch (message.method) {
      case "Debugger.paused":
        invariant(Array.isArray(params.callFrames), "DEBUG_PROTOCOL_ERROR", "Ark VM returned no pause stack");
        this.pause = { callFrames: params.callFrames, reason: typeof params.reason === "string" ? params.reason : undefined };
        detail = { reason: this.pause.reason, frames: this.pause.callFrames.length, hitBreakpoints: params.hitBreakpoints };
        if (this.pause.reason === "Break on start" && this.releaseStartup && (!Array.isArray(params.hitBreakpoints) || !params.hitBreakpoints.length)) {
          const pause = this.pause;
          this.queuePause(pause, (signal) => this.releasePause(pause, signal), { reason: "startup" });
        } else if (Array.isArray(params.hitBreakpoints)) this.onBreakpoint(this.pause, params.hitBreakpoints);
        break;
      case "Debugger.resumed": this.pause = undefined; break;
      case "Debugger.scriptParsed":
        if (typeof params.scriptId === "string" && typeof params.url === "string") {
          this.scripts.set(params.scriptId, params.url);
          if (this.scripts.size > 20000) this.scripts.delete(this.scripts.keys().next().value!);
        }
        detail = { script_id: params.scriptId, url: params.url };
        break;
      case "Debugger.breakpointResolved": break;
      default: return;
    }
    this.log(message.method, detail);
  }

  private log(event: string, detail: Json) {
    const entry = { id: ++this.lastEvent, event, at: Date.now(), detail };
    this.events.push(entry);
    this.eventLog?.append(entry, this.id, this.instance);
    if (this.events.length > 300) this.events.shift();
  }

  private onBreakpoint(paused: Pause, hits: unknown[]) {
    const matches = [...this.breakpoints.values()].filter((entry) => entry.enabled && hits.some((hit) => {
      if (hit === entry.vmId) return true;
      const m = typeof hit === "string" ? /^id:(\d+):\d+:(.+)$/.exec(hit) : null;
      return m && m[2] === entry.url && entry.locations.some((location) => location.lineNumber === Number(m[1]));
    }));
    const target = matches[0];
    if (matches.length !== 1 || !target) return;
    target.hits++;
    const logpoint = target.log !== undefined || target.log_expression !== undefined;
    if (!target.condition && !logpoint && !target.hit_count) return;
    this.queuePause(paused, async (signal) => {
      let pass = hitCountMatches(target.hit_count, target.hits);
      if (pass && target.condition) {
        const expression = parseCondition(target.condition);
        pass = Boolean(await evaluateCondition(expression, (segments) => this.readOperand(paused, segments, signal)));
      }
      if (pass && target.log_expression) {
        const expression = parseCondition(target.log_expression);
        const value = await evaluateCondition(expression, (segments) => this.readOperand(paused, segments, signal));
        this.log("Debugger.logpoint", { breakpointId: target.breakpointId, level: target.level, text: String(value).slice(0, 2000) });
      } else if (pass && target.log) {
        const values = new Map<string, unknown>();
        for (const [, name] of target.log.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)) {
          if (!values.has(name!)) {
            invariant(values.size < 16, "INVALID_INPUT", "A logpoint supports at most 16 variable references");
            const value = primitiveValue(await this.evaluate(paused, 0, name!, signal));
            invariant(value !== undefined, "EVIDENCE_MISSING", "Ark VM could not resolve the logpoint variable", { variable: name });
            values.set(name!, value);
          }
        }
        this.log("Debugger.logpoint", { breakpointId: target.breakpointId, level: target.level,
          text: target.log.replace(/\{([A-Za-z_$][\w$]*)\}/g, (_, name: string) => String(values.get(name)).slice(0, 256)) });
      }
      if (!pass || logpoint) await this.releasePause(paused, signal);
    }, { breakpointId: target.breakpointId });
  }

  private async readOperand(paused: Pause, segments: string[], signal: AbortSignal): Promise<Primitive> {
    const result = await this.readVariable(paused, 0, segments, signal), value = primitiveValue(result);
    invariant(result.type === "undefined" || value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number",
      "EVIDENCE_MISSING", "Condition did not resolve to a primitive", { variable: segments.join(".") });
    return result.type === "undefined" ? undefined : value as Primitive;
  }

  private async properties(objectId: string, signal: AbortSignal): Promise<{ name: string; value?: Json; get?: unknown; set?: unknown; isOwn?: boolean }[]> {
    const value = await this.call("Runtime.getProperties", { objectId, ownProperties: true }, signal);
    invariant(Array.isArray(value.result), "DEBUG_PROTOCOL_ERROR", "Ark VM returned no inspectable properties");
    return value.result;
  }

  private async readVariable(paused: Pause | undefined, frame: number, segments: string[], signal: AbortSignal) {
    const [root, ...members] = segments;
    let result = await this.evaluate(paused, frame, root!, signal);
    for (const member of members) {
      invariant(typeof result.objectId === "string", "EVIDENCE_MISSING", "Variable property does not belong to an inspectable object", { member });
      const property = (await this.properties(result.objectId, signal)).find((entry) => entry.name === member && entry.isOwn !== false);
      invariant(property?.value && !property.get && !property.set, "EVIDENCE_MISSING", "Variable property must be an own data property", { member });
      result = property.value;
    }
    invariant(this.pause === paused, "CONFLICT", "The paused frame changed during variable inspection");
    return result;
  }

  private queuePause(paused: Pause, process: (signal: AbortSignal) => Promise<void>, detail: Json) {
    const settled = (this.breakpointWork ?? Promise.resolve()).then(async () => {
      const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(8000)]);
      while (this.response) await delay(20, undefined, { signal });
      if (this.pause === paused && !this.closing) await process(signal);
    }).catch((error) => this.log("Debugger.breakpointError", { ...detail, error: errorResult(error) }));
    this.breakpointWork = settled;
    void settled.then(() => { if (this.breakpointWork === settled) this.breakpointWork = undefined; });
  }

  private async releasePause(paused: Pause, signal: AbortSignal) {
    invariant(this.pause === paused, "CONFLICT", "Debugger frame changed before automatic resume");
    await this.call("Debugger.resume", {}, signal);
    if (this.pause === paused) this.pause = undefined;
  }

  private async evaluate(paused: Pause | undefined, frame: number, expression: string, signal: AbortSignal) {
    const context = paused?.callFrames[frame];
    invariant(context, "CONFLICT", "Evaluation requires a paused frame", { frame });
    const data = await this.call("Debugger.evaluateOnCallFrame", { callFrameId: context.callFrameId, expression }, signal);
    invariant(this.pause === paused, "CONFLICT", "The paused frame changed during evaluation");
    invariant(!data.exceptionDetails && data.result && typeof data.result === "object", "DEBUG_PROTOCOL_ERROR", "Ark VM could not evaluate this expression");
    return data.result as Json;
  }

  private call(method: string, params: Json, signal: AbortSignal, timeout = 8000) {
    signal.throwIfAborted();
    const socket = this.socket;
    invariant(socket?.readyState === WebSocket.OPEN && !this.response, "DEBUG_DISCONNECTED", "ArkTS debugger is closed or already processing a request");
    return new Promise<Json>((resolve, reject) => {
      const id = ++this.nextId;
      const settle = (error?: unknown, result?: Json) => {
        if (this.response?.id !== id) return;
        this.response = undefined;
        signal.removeEventListener("abort", aborted);
        clearTimeout(timer);
        if (error) reject(error); else resolve(result ?? {});
      };
      const aborted = () => settle(signal.reason);
      const timer = setTimeout(() => settle(new ToolError("TIMEOUT", `Ark debugger did not acknowledge ${method}`)), timeout);
      this.response = { id, settle };
      signal.addEventListener("abort", aborted, { once: true });
      socket.send(JSON.stringify({ id, method, params }), (error) => { if (error) settle(error); });
    });
  }

  status() {
    return { session_id: this.id, target: this.target, bundle: this.bundle, pid: this.pid, thread: this.instance,
      state: this.socket?.readyState !== WebSocket.OPEN ? "disconnected" : this.pause ? "paused" : "running", reason: this.pause?.reason, scripts: this.scripts.size,
      ...(this.eventLog && { event_log: this.eventLog.status() }) };
  }

  async inspect(input: Request, signal: AbortSignal): Promise<Json | undefined> {
    await this.breakpointWork;
    signal.throwIfAborted();
    if (input.op === "threads") {
      await this.connectBroker(signal);
      return { threads: [{ thread: 0, name: "main", state: this.status().state }, ...[...this.workers.values()].map((worker) => ({
        thread: worker.id, tid: worker.tid, name: worker.name, state: worker.error ? "failed" : worker.connected ? worker.channel?.status().state : "connecting", error: worker.error,
      }))] };
    }
    if (input.thread && !this.instance) {
      const worker = this.workers.get(input.thread);
      invariant(worker?.connected && worker.channel && !worker.error && worker.channel.status().state !== "disconnected", "NOT_FOUND", "The selected Ark worker is not attached", { thread: input.thread, error: worker?.error });
      return worker.channel.inspect(input, signal);
    }
    const limit = input.limit ?? 20, frame = input.frame ?? 0;
    switch (input.op) {
      case "stack": {
        invariant(this.pause, "CONFLICT", "Pause the ArkTS debugger before inspecting its stack");
        return { frames: this.pause.callFrames.slice(frame, frame + limit).map((item, i) => {
          const url = item.url || this.scripts.get(String(item.location?.scriptId));
          const line = typeof item.location?.lineNumber === "number" ? item.location.lineNumber + 1 : undefined;
          const column = typeof item.location?.columnNumber === "number" ? item.location.columnNumber + 1 : undefined;
          const source = url && line ? locate(`${url}:${line}:${column ?? 1}`, this.project, 1)[0] : undefined;
          return { frame: frame + i, function: item.functionName, url, line, column, source, location: item.location };
        }) };
      }
      case "vars": {
        if (input.symbol !== undefined) {
          invariant(memberPath.test(input.symbol), "INVALID_INPUT", "Variable symbol must be a local name or property path");
          const value = await this.readVariable(this.pause, frame, input.symbol.split("."), signal);
          const properties = typeof value.objectId === "string" ? await this.properties(value.objectId, signal) : [];
          return { frame, variable: input.symbol, value, properties: properties.slice(0, limit), omitted: Math.max(0, properties.length - limit) };
        }
        const scope = this.pause?.callFrames[frame]?.scopeChain;
        invariant(scope, "CONFLICT", "No scopes for this paused frame", { frame });
        const variables = [];
        for (const { type, object } of scope.filter((s) => s.type !== "global")) if (object?.objectId) {
          const properties = await this.properties(object.objectId, signal);
          variables.push({ scope: type, properties: properties.slice(0, limit), omitted: Math.max(0, properties.length - limit) });
        }
        return { frame, variables };
      }
      case "eval": case "set": {
        const query = input.query;
        invariant(typeof query === "string" && query.trim() && query.length <= 4096, "INVALID_INPUT", "Pass a bounded expression or JSON literal in query");
        const paused = this.pause, evaluate = (expression: string) => this.evaluate(paused, frame, expression, signal);
        if (input.op === "eval") return { frame, value: await evaluate(query) };
        invariant(input.symbol && /^[A-Za-z_$][\w$]*$/.test(input.symbol), "INVALID_INPUT", "Set requires one local variable name in symbol");
        let value: unknown;
        try { value = JSON.parse(query); } catch { throw new ToolError("INVALID_INPUT", "Set query must be a JSON literal"); }
        invariant(value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number" && Number.isFinite(value), "INVALID_INPUT", "Set supports primitive JSON values");
        const prior = await evaluate(input.symbol);
        await evaluate(`${input.symbol} = ${JSON.stringify(value)}`);
        const actual = await evaluate(input.symbol);
        invariant(Object.is(primitiveValue(actual), value), "EVIDENCE_MISSING", "The VM did not confirm the write", { variable: input.symbol, actual: primitiveValue(actual) });
        return { frame, variable: input.symbol, applied: true, before: primitiveValue(prior), value: primitiveValue(actual) };
      }
      case "events": {
        const deadline = Date.now() + (input.wait ?? 0), filters = input.query?.split(",").map((item) => item.trim());
        let cursor = input.line ?? 0;
        const dropped = cursor + 1 < (this.events[0]?.id ?? 0), lifetime = AbortSignal.any([signal, this.lifetime.signal]);
        for (;;) {
          const latest = this.events.filter(({ id }) => id > cursor);
          const events = (filters ? latest.filter(({ event }) => filters.includes(event)) : latest).slice(0, limit);
          cursor = (events.length === limit ? events : latest).at(-1)?.id ?? cursor;
          if (events.length || dropped || Date.now() >= deadline) return { events, cursor, dropped };
          await delay(Math.min(75, deadline - Date.now()), undefined, { signal: lifetime });
        }
      }
      case "break_list": return { breakpoints: [...this.breakpoints.values()].filter((entry) => this.matchesKind(entry, input.break_kind)) };
      case "break_remove": case "break_disable": case "break_enable": {
        const byLocation = input.file !== undefined || input.line !== undefined;
        invariant(Number(!!input.query) + Number(byLocation) + Number(input.all === true) === 1 && (!byLocation || input.file && input.line),
          "INVALID_INPUT", "Select one breakpoint ID (query), a file and line, or all=true");
        const file = input.file ? this.breakpointFile(input.file) : undefined;
        const entries = [...this.breakpoints.values()].filter((entry) => input.all ? this.matchesKind(entry, input.break_kind)
          : byLocation ? entry.file === file && entry.requested_line === input.line : entry.breakpointId === input.query);
        invariant(input.all || entries.length === 1, "NOT_FOUND", "No matching breakpoint in this thread");
        const changed: (Breakpoint | { removed: string })[] = [];
        for (const entry of entries) {
          try {
            if (input.op === "break_enable") {
              if (!entry.enabled) Object.assign(entry, await this.bindBreakpoint(entry, signal), { enabled: true });
              changed.push(entry);
            } else {
              if (entry.enabled) await this.call("Debugger.removeBreakpoint", { breakpointId: entry.vmId }, signal);
              entry.enabled = false;
              if (input.op === "break_disable") changed.push(entry);
              else { this.breakpoints.delete(entry.breakpointId); changed.push({ removed: entry.breakpointId }); }
            }
          } catch (error) {
            if (!input.all) throw error;
            const cause = errorResult(error);
            throw new ToolError(cause.code, cause.message, { ...cause.details, completed: changed, failed: entry.breakpointId });
          }
        }
        return input.all ? { changed } : changed[0];
      }
      case "break_add": {
        invariant(input.file && input.line, "INVALID_INPUT", "A breakpoint needs file and a 1-based line");
        if (input.query !== undefined) parseCondition(input.query);
        if (input.hit_count !== undefined) hitCountMatches(input.hit_count, 0);
        invariant(input.text === undefined || input.text.length > 0 && input.text.length <= 2000, "INVALID_INPUT", "Logpoints need 1–2000 characters of text");
        invariant(input.text === undefined || input.log_expression === undefined, "INVALID_INPUT", "Choose logpoint text or log_expression");
        if (input.log_expression !== undefined) parseCondition(input.log_expression);
        const logpoint = input.text !== undefined || input.log_expression !== undefined;
        invariant(input.log_level === undefined || logpoint, "INVALID_INPUT", "log_level requires a logpoint");
        const requested = input.file.replaceAll("\\", "/"), urls = [...new Set(this.scripts.values())], project = this.project;
        const runtime = urls.filter((url) => url === requested);
        const candidates = runtime.length ? runtime.map((url) => ({ url, lineNumber: input.line! - 1, columnNumber: (input.column ?? 1) - 1 }))
          : project ? urls.flatMap((url) => {
            const mapped = mapBreakpoint(url, project, path.resolve(project.root, requested), input.line!, input.column);
            return mapped ? [{ url, ...mapped }] : [];
          }) : [];
        invariant(candidates.length === 1, "EVIDENCE_MISSING", "The source does not resolve to one loaded Ark script", { matches: candidates });
        const location = candidates[0]!;
        invariant(![...this.breakpoints.values()].some((entry) => entry.url === location.url && entry.lineNumber === location.lineNumber),
          "CONFLICT", "This generated line already has a breakpoint");
        const bound = input.disabled ? { vmId: "", locations: [] } : await this.bindBreakpoint(location, signal);
        const result = { ...location, ...bound, breakpointId: bound.vmId || `bp_${crypto.randomUUID()}`, file: this.breakpointFile(requested), requested_line: input.line,
          enabled: !input.disabled, hits: 0, hit_count: input.hit_count, condition: input.query,
          log: input.text, log_expression: input.log_expression, level: logpoint ? input.log_level ?? "info" : undefined };
        this.breakpoints.set(result.breakpointId, result);
        return result;
      }
      case "pause": case "resume": case "step_into": case "step_over": case "step_out": {
        if (input.op === "pause" && this.pause || input.op === "resume" && !this.pause) return this.status();
        invariant(input.op === "pause" || this.pause, "CONFLICT", "Pause the debugger before single-stepping");
        const method = { pause: "pause", resume: "resume", step_into: "stepInto", step_over: "stepOver", step_out: "stepOut" }[input.op];
        if (input.op === "resume" && this.pause?.reason === "Break on start") this.releaseStartup = true;
        const first = this.lastEvent;
        await this.call(`Debugger.${method}`, {}, signal);
        const event = input.op === "resume" ? "Debugger.resumed" : "Debugger.paused";
        const deadline = Date.now() + 4000;
        while (!this.events.some((entry) => entry.id > first && entry.event === event) && Date.now() < deadline)
          await delay(50, undefined, { signal });
        const confirmed = this.events.some((entry) => entry.id > first && entry.event === event);
        return { ...this.status(), confirmed };
      }
      default: return this.status();
    }
  }

  private breakpointFile(file: string) {
    const normalized = file.replaceAll("\\", "/");
    return !this.project || [...this.scripts.values()].includes(normalized) ? normalized : path.resolve(this.project.root, normalized);
  }

  private matchesKind(entry: Breakpoint, kind: Request["break_kind"]) {
    return !kind || kind === "all" || kind === (entry.log === undefined && entry.log_expression === undefined ? "breakpoint" : "logpoint");
  }

  private async bindBreakpoint(location: { url: string; lineNumber: number; columnNumber: number }, signal: AbortSignal) {
    const { url, lineNumber, columnNumber } = location;
    const result = await this.call("Debugger.setBreakpointByUrl", { url, lineNumber, columnNumber }, signal);
    invariant(typeof result.breakpointId === "string" && Array.isArray(result.locations), "DEBUG_PROTOCOL_ERROR", "Ark VM returned no breakpoint identity");
    return { vmId: result.breakpointId, locations: result.locations as Breakpoint["locations"] };
  }

  async close() {
    this.closing = true;
    this.lifetime.abort();
    await this.breakpointWork;
    const errors = [];
    if (this.broker) {
      try { this.broker.socket.terminate(); await removeForward(this.target, this.broker.port, this.broker.remote); this.broker = undefined; }
      catch (error) { errors.push(errorResult(error)); }
    }
    for (const worker of this.workers.values()) {
      try { await worker.ready; await worker.channel?.close(); this.workers.delete(worker.id); }
      catch (error) { errors.push(errorResult(error)); }
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      try { await this.call("Debugger.disable", {}, AbortSignal.timeout(800), 750); }
      catch (error) { errors.push(errorResult(error)); }
    }
    this.socket?.terminate();
    if (this.forward) {
      try {
        await removeForward(this.target, this.port, this.remote);
        this.forward = false;
      } catch (error) { errors.push(errorResult(error)); }
    }
    if (this.attached) {
      try {
        const result = await shell(this.target, ["aa", "detach", "-b", this.bundle], undefined, 4000);
        invariant(result.code === 0 && /detach app debug successfully/i.test(result.stdout + result.stderr), "DEVICE_CLEANUP_FAILED", "Could not detach the Ark debugger from its app");
        this.attached = false;
      } catch (error) { errors.push(errorResult(error)); }
    }
    if (!this.instance) this.eventLog?.close();
    if (errors.length) throw new ToolError("DEVICE_CLEANUP_FAILED", "Ark debugger cleanup did not complete", { session_id: this.id, errors });
    if (!this.instance) open.delete(this.id);
  }
}

function freeApp(target: string, bundle: string) {
  invariant(![...open.values()].some((entry) => entry.target === target && entry.bundle === bundle), "RESOURCE_BUSY", "This app already has an ArkTS debug session");
}

async function openDebug(project: Project | undefined, target: string, bundle: string, pid: number, signal: AbortSignal,
  options: { started?: boolean; stopAtEntry?: boolean; output?: string } = {}) {
  const id = `ark_${crypto.randomUUID()}`, port = await localPort();
  return poolById.use(id, async () => {
    signal.throwIfAborted();
    const session = new Debugger(id, target, bundle, pid, port, project, 0, options.output ? new EventLog(options.output) : undefined);
    try { await session.connect(signal, options.started, options.stopAtEntry); }
    catch (error) {
      try { await session.close(); }
      catch (cleanup) { throw new ToolError("DEVICE_CLEANUP_FAILED", "Failed Ark debugger attach requires cleanup", { attach: errorResult(error), cleanup: errorResult(cleanup) }); }
      throw error;
    }
    open.set(id, session);
    return session;
  }, async (session) => session.status());
}

async function waitForDebugPid(target: string, bundle: string, options: { pid?: number; exclude?: number; signal?: AbortSignal }) {
  const found = new AbortController();
  let pid: number | undefined;
  try {
    await run(toolCommand("hdc", ["-t", target, "track-jpid"]), {
      signal: options.signal ? AbortSignal.any([options.signal, found.signal]) : found.signal,
      timeoutMs: 20000,
      onLine(line, stream) {
        if (stream !== "stdout" || found.signal.aborted) return;
        const match = /^([1-9]\d*)\s+(\S+)$/.exec(line.trim());
        if (match?.[2] !== bundle) return;
        const candidate = Number(match[1]);
        if (candidate === options.exclude || options.pid !== undefined && candidate !== options.pid) return;
        pid = candidate;
        found.abort();
      },
    });
  } catch (error) {
    if (options.signal?.aborted || !found.signal.aborted || !(error instanceof ToolError) || error.code !== "CANCELLED") throw error;
  }
  invariant(pid, "EVIDENCE_MISSING", "HDC did not report the launched app as debuggable", { target, bundle });
  return pid;
}

export async function startArkDebug(input: { project: string; target?: string; product?: string; module?: string; modules?: string[]; ability?: string; bundle?: string; output_path?: string; skip_build?: boolean; stop_at_entry?: boolean }, signal: AbortSignal, jobId: string) {
  if (input.output_path !== undefined) validateEventLog(input.output_path);
  const project = inspectProject(input.project, input.product), bundle = project.bundleName;
  invariant(bundle && /^[\w.]+$/.test(bundle), "PROJECT_INVALID", "A debug launch needs a project bundle");
  invariant(input.bundle === undefined || input.bundle === bundle, "CONFLICT", "Selected bundle differs from the package this project builds", { bundle });
  const target = await resolveTarget(input.target, signal, runnableDeviceTypes(project));
  freeApp(target, bundle);
  const info = await deviceSummary(target, signal), selection = selectRunModules(project, { modules: input.modules, deviceType: info.device_type });
  const runnable = selection.modules.filter((module) => module.type === "entry" || module.type === "feature");
  const selected = input.module ? runnable.find((module) => module.name === input.module) : runnable.find((module) => module.type === "entry") ?? (runnable.length === 1 ? runnable[0] : undefined);
  invariant(selected, "INVALID_INPUT", "Choose a launch module from the selected entry or feature modules", { modules: runnable.map((module) => module.name) });
  const main = mainAbility(project, selected.name, input.ability);
  invariant(/^[\w.$]+$/.test(main.ability) && /^[\w.]+$/.test(main.module), "PROJECT_INVALID", "The debug launcher needs a valid ability/module identity");
  const haps = selection.modules.filter((module) => module.type !== "shared").map((module) => module.name);
  const shared = project.modules.filter((module) => module.type === "shared").map((module) => module.name);
  if (!input.skip_build) {
    await buildProject(project, { task: "assembleHap", modules: haps, debug_line: true }, signal, jobId);
    if (shared.length) await buildProject(project, { task: "assembleHsp", modules: shared, debug_line: true }, signal, jobId);
  }
  const built = await buildOutputs(project, "assembleHap", project.modules.filter((entry) => haps.includes(entry.name)));
  const hsp = await buildOutputs(project, "assembleHsp", project.modules.filter((entry) => shared.includes(entry.name)));
  invariant(built.length === haps.length && hsp.length === shared.length, "EVIDENCE_MISSING", "A selected module is missing a built HAP/HSP");
  await install(target, [...built, ...hsp].map((entry) => entry.path), signal);
  const previousPid = await pidOf(target, bundle, signal);
  if (previousPid) await forceStop(target, bundle, signal);
  signal.throwIfAborted();
  let pid: number | undefined, started = false;
  try {
    const receipt = await shell(target, ["aa", "start", "-b", bundle, "-a", main.ability, "-m", main.module, "-D"], undefined, 15000);
    invariant(receipt.code === 0 && /start ability successfully/i.test(receipt.stdout + receipt.stderr), "LAUNCH_FAILED", "Ability Manager rejected debug launch");
    started = true;
    // The process can exist before HDC can forward its debugger channel.
    pid = await waitForDebugPid(target, bundle, { exclude: previousPid });
    signal.throwIfAborted();
    const sources = input.module ? { ...project, modules: [selected] } : project;
    return await openDebug(sources, target, bundle, pid, signal, { started: true, stopAtEntry: input.stop_at_entry, output: input.output_path });
  } catch (error) {
    const cleanup = AbortSignal.timeout(5000);
    try {
      if (started) {
        const running = await pidOf(target, bundle, cleanup);
        invariant(!running || !pid || running === pid, "CONFLICT", "Another process took over after debug launch");
        if (running) await forceStop(target, bundle, cleanup);
      }
    }
    catch (cleanupError) { throw new ToolError("DEVICE_CLEANUP_FAILED", "Debug launch failed and its process could not be stopped", { original: errorResult(error), cleanup: errorResult(cleanupError) }); }
    throw error;
  }
}

export async function arkDebug(input: Request, target: string | undefined, project: Project | undefined, signal: AbortSignal) {
  invariant(input.thread === undefined || !["attach", "threads", "stop"].includes(input.op), "INVALID_INPUT", "Select a thread only for inspection or debugger commands");
  if (input.op === "status" && !input.session_id) return { sessions: [...open.values()].map((entry) => entry.status()) };
  if (input.op === "attach") {
    if (input.output_path !== undefined) validateEventLog(input.output_path);
    const bundle = input.bundle ?? project?.bundleName;
    invariant(target && bundle && /^[\w.]+$/.test(bundle), "INVALID_INPUT", "Attach requires a bundle and selected device");
    invariant(!project || project.bundleName === bundle, "CONFLICT", "The source project belongs to another bundle", { bundle: project?.bundleName });
    if (input.module !== undefined) {
      const module = project?.modules.find((entry) => entry.name === input.module);
      invariant(project && module, "INVALID_INPUT", "Attach module requires a module in the source project", { module: input.module });
      project = { ...project, modules: [module] };
    }
    freeApp(target, bundle);
    const identity = await shell(target, ["pidof", bundle], signal, 8000);
    const listing = identity.stdout.trim();
    invariant(identity.code === 0 && /^\d+(?:\s+\d+)*$/.test(listing), "EVIDENCE_MISSING", "No running processes found for this bundle");
    const pids = listing.split(/\s+/).map(Number), pid = input.pid ?? (pids.length === 1 ? pids[0] : undefined);
    invariant(pid && pids.includes(pid), "CONFLICT", "Select a PID from the running processes of this bundle", { pids });
    return openDebug(project, target, bundle, pid, signal, { output: input.output_path });
  }
  const id = input.session_id;
  invariant(id && poolById.has(id) && open.has(id), "NOT_FOUND", "Pass a session ID from this MCP process");
  if (input.op === "stop") {
    const session = open.get(id)!;
    await poolById.close(id);
    const { event_log } = session.status();
    return { stopped: true, session_id: id, ...(event_log && { event_log }) };
  }
  return poolById.use(id, async () => { throw new ToolError("NOT_FOUND", "Ark debugger session closed"); }, (session) => session.inspect(input, signal));
}
