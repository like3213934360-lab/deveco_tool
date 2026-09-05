import { spawn } from "node:child_process";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { terminateProcessTree } from "./process-tree.mjs";

// The SDK stdio transport owns only its immediate PID. CodeGenie's npm entry
// spawns a native backend, so the gateway must own the whole process group.
export class CodeGenieTransport {
  constructor(params) {
    this.params = params;
    this.buffer = new ReadBuffer();
  }

  async start() {
    if (this.child) throw new Error("CodeGenie transport already started");
    const child = spawn(this.params.command, this.params.args, {
      cwd: this.params.cwd,
      env: { ...getDefaultEnvironment(), ...this.params.env },
      stdio: ["pipe", "pipe", "inherit"],
      detached: process.platform !== "win32", windowsHide: true, shell: false,
    });
    this.child = child;
    this.closed = new Promise((resolve) => child.once("close", () => {
      resolve();
      this.onclose?.();
    }));
    // A wrapper can exit without waiting for its backend. Reap its group too.
    child.once("exit", () => {
      if (!this.closing) terminateProcessTree(child, 300);
    });
    child.on("error", (error) => this.onerror?.(error));
    child.stdin.on("error", (error) => this.onerror?.(error));
    child.stdout.on("error", (error) => this.onerror?.(error));
    child.stdout.on("data", (data) => {
      try {
        this.buffer.append(data);
        let message;
        while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
        void this.close();
      }
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  }

  send(message) {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin.writable || this.closing) { reject(new Error("Not connected")); return; }
      this.child.stdin.write(serializeMessage(message), (error) => error ? reject(error) : resolve());
    });
  }

  close() {
    if (!this.closing) this.closing = this.closeTree();
    return this.closing;
  }

  async closeTree() {
    if (!this.child) return;
    terminateProcessTree(this.child, 300);
    // Retain the event loop through escalation even if the wrapper exits first.
    await new Promise((resolve) => setTimeout(resolve, 350));
    let timer;
    await Promise.race([this.closed, new Promise((resolve) => { timer = setTimeout(resolve, 1000); })]);
    clearTimeout(timer);
    this.buffer.clear();
  }
}
