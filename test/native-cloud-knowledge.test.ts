import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { AuthService } from "../src/services/auth.js";
import { KnowledgeService } from "../src/services/knowledge.js";

test("cloud knowledge refreshes once on provider expiry and bounds malformed or repeatedly expired responses", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "deveco-knowledge-expiry-"),
  );
  const store = new StateStore(root),
    processes = new ProcessService();
  const auth = new AuthService(store, processes),
    knowledge = new KnowledgeService(store, auth);
  let replies: string[] = [],
    calls = 0;
  let forced: boolean[] = [];
  t.mock.method(
    auth,
    "credentials",
    async (provider: string, _signal?: AbortSignal, force = false) => {
      assert.equal(provider, "codegenie");
      forced.push(force);
      return {
        jwt: "fixture-jwt",
        access: force ? "new-token" : "old-token",
        saved: Date.now(),
        userId: "fixture",
        userName: "Fixture",
      };
    },
  );
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      assert.equal(
        String(input),
        "https://cn.devecostudio.huawei.com/codeGenie/bigSearch",
      );
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        calls ? "new-token" : "old-token",
      );
      assert.deepEqual(JSON.parse(String(options?.body)), {
        question: "fixture query",
      });
      assert.ok(calls < replies.length, "Unexpected retry");
      return new Response(replies[calls++]);
    },
  );
  const expired = JSON.stringify({ error_code: 4016 });
  try {
    replies = [
      expired,
      JSON.stringify({
        code: 200,
        body: { answer: { prompt: "prefix【检索信息】：verified fixture" } },
      }),
    ];
    assert.deepEqual(await knowledge.cloud("fixture query"), {
      source: "cloud",
      content: "verified fixture",
    });
    assert.deepEqual(forced, [false, true]);
    for (const response of [
      expired,
      JSON.stringify({ code: 200, body: { answer: { prompt: null } } }),
      "{",
    ]) {
      replies = response === expired ? [expired, expired] : [response];
      calls = 0;
      forced = [];
      await assert.rejects(knowledge.cloud("fixture query"));
      assert.equal(calls, replies.length);
      assert.deepEqual(forced, calls === 2 ? [false, true] : [false]);
    }
  } finally {
    knowledge.close();
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
