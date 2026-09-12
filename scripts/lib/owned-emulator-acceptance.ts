import crypto from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { AcceptanceMcp } from "./mcp-acceptance-client.js";
import { ProcessService } from "../../src/core/process.js";
import { discoverToolchain, toolCommand } from "../../src/core/toolchain.js";
import { ToolError } from "../../src/core/errors.js";
import { emulatorBinding } from "../../src/services/emulator-identity.js";

const instance = z.object({
  name: z.string(),
  isRunning: z.boolean(),
  instancePath: z.string().optional(),
});
const state = z.object({
  status: z.string(),
  result: z.unknown(),
  error: z.unknown().optional(),
});
/** Owned, name/endpoint-bound emulator and public durable-operation harness.
 * Evidence writers run after every state transition so an interrupted driver
 * leaves request keys and run IDs for inspection, never an automatic retry. */
export class OwnedEmulatorAcceptance {
  readonly name = `NativeMcp${crypto.randomBytes(4).toString("hex")}`;
  readonly processes = new ProcessService();
  target?: string;
  private initial?: z.infer<typeof instance>[];
  constructor(
    readonly mcp: AcceptanceMcp,
    readonly record: (key: string, value: unknown) => void,
    readonly lifecycle: AcceptanceMcp = mcp,
  ) {}
  async inventory() {
    return z
      .object({ instances: z.array(instance) })
      .parse(await this.lifecycle.call("emulator_manage", { action: "list" }))
      .instances;
  }
  async settle(
    key: string,
    run_id: string,
    expected = "succeeded",
    client = this.mcp,
  ) {
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const value = state.parse(
        await client.call("workflow_run", {
          action: "status",
          run_id,
          wait_ms: 1000,
        }),
      );
      this.record(key, { run_id, ...value });
      if (["queued", "running", "cancelling"].includes(value.status)) continue;
      assert.equal(value.status, expected, JSON.stringify(value.error));
      console.log(`${key}: ${expected}`);
      return { run_id, ...value };
    }
    throw new ToolError(
      "ACCEPTANCE_TIMEOUT",
      "Inspect the recorded run before any repeated effect",
    );
  }
  async submit(
    key: string,
    tool: string,
    input: Record<string, unknown>,
    client = this.mcp,
  ) {
    const request_key = `owned-emulator:${this.name}:${key}`;
    this.record(key, { request_key, status: "submitting" });
    const value = z
      .object({ run_id: z.string() })
      .parse(await client.call(tool, { ...input, request_key }));
    this.record(key, value);
    return value.run_id;
  }
  async operation(
    key: string,
    tool: string,
    input: Record<string, unknown>,
    expected = "succeeded",
    client = this.mcp,
  ) {
    return this.settle(
      key,
      await this.submit(key, tool, input, client),
      expected,
      client,
    );
  }
  async workflow(
    key: string,
    workflow: string,
    input: unknown,
    expected = "succeeded",
  ) {
    return this.operation(
      key,
      "workflow_run",
      { action: "start", workflow, input },
      expected,
    );
  }
  async output(result: unknown, key: string): Promise<unknown> {
    const item = z.record(z.string(), z.unknown()).parse(result)[key];
    const ref = z
      .object({
        result_artifact: z.object({
          artifact_id: z.string(),
          bytes: z.number().max(8 * 1024 * 1024),
        }),
      })
      .safeParse(item);
    if (!ref.success) return item;
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < ref.data.result_artifact.bytes;) {
      const page = z
        .object({ data: z.string(), next_offset: z.number() })
        .parse(
          await this.mcp.call("workflow_run", {
            action: "read_artifact",
            artifact_id: ref.data.result_artifact.artifact_id,
            offset,
            limit: 65536,
          }),
        );
      assert.ok(
        page.next_offset > offset &&
          page.next_offset <= ref.data.result_artifact.bytes,
      );
      chunks.push(Buffer.from(page.data, "base64"));
      offset = page.next_offset;
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  private async bind() {
    const owned = (await this.inventory()).find(
      (item) => item.name === this.name,
    );
    assert.ok(owned?.isRunning);
    const targets = z
      .object({ targets: z.array(z.string()) })
      .parse(await this.lifecycle.call("device_info", { list: true })).targets;
    const results = await Promise.allSettled(
      targets
        .filter((id) => /^(127\.0\.0\.1|localhost|\[::1\]):/.test(id))
        .map((id) =>
          emulatorBinding(this.name, owned.instancePath, id, async () => {
            const result = await this.processes.run(
              toolCommand(discoverToolchain(), "hdc", [
                "-t",
                id,
                "shell",
                "param",
                "get",
                "ohos.qemu.hvd.name",
              ]),
              { timeoutMs: 10000 },
            );
            assert.equal(result.truncated, false);
            return result.stdout.trim();
          }),
        ),
    );
    const matched = results.filter((item) => item.status === "fulfilled");
    assert.ok(matched.length <= 1);
    if (matched[0]) {
      this.target = matched[0].value.target;
      this.record("binding", matched[0].value);
    }
  }
  async start() {
    this.initial = await this.inventory();
    this.record("initial_inventory", this.initial);
    assert.equal(
      this.initial.some((item) => item.name === this.name),
      false,
    );
    this.record("owned_instance", this.name);
    const images = z
      .object({
        images: z.array(
          z.object({ deviceType: z.string(), osVersion: z.string() }),
        ),
      })
      .parse(
        await this.lifecycle.call("emulator_manage", {
          action: "images",
          downloaded: true,
          device_type: "phone",
        }),
      );
    const image = images.images[0];
    assert.ok(image);
    this.record("image", image);
    await this.operation(
      "create",
      "emulator_manage",
      {
        action: "create",
        name: this.name,
        device_type: image.deviceType,
        os_version: image.osVersion,
      },
      "succeeded",
      this.lifecycle,
    );
    await this.operation(
      "start",
      "emulator_manage",
      {
        action: "start",
        name: this.name,
      },
      "succeeded",
      this.lifecycle,
    );
    const deadline = Date.now() + 120000;
    while (!this.target && Date.now() < deadline) {
      await this.bind();
      if (!this.target) await delay(1000);
    }
    assert.ok(
      this.target,
      "Owned emulator did not expose a verified HDC endpoint",
    );
    return this.target;
  }
  async close() {
    if (this.initial) {
      const owned = (await this.inventory()).find(
        (item) => item.name === this.name,
      );
      if (owned?.isRunning) {
        if (!this.target) await this.bind();
        assert.ok(
          this.target,
          "Owned emulator is running but its endpoint cannot be verified; preserve it for inspection",
        );
        await this.operation(
          "stop",
          "emulator_manage",
          {
            action: "stop",
            name: this.name,
            target: this.target,
          },
          "succeeded",
          this.lifecycle,
        );
      }
      // Restart only the isolated MCP so terminal leases are recovered before
      // deleting our now-stopped instance. Never restart the user's host.
      await this.lifecycle.close();
      await this.lifecycle.connect();
      if (owned)
        await this.operation(
          "delete",
          "emulator_manage",
          {
            action: "delete",
            name: this.name,
          },
          "succeeded",
          this.lifecycle,
        );
      const final = await this.inventory();
      this.record("final_inventory", final);
      assert.deepEqual(final, this.initial);
    }
    await this.mcp.close();
    if (this.lifecycle !== this.mcp) await this.lifecycle.close();
    await this.processes.close();
    assert.equal(this.processes.size, 0);
  }
}
