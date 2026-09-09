import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { AuthService } from "../src/services/auth.js";
import { SignatureService } from "../src/services/signature.js";

const device = (index: number) => ({
  id: String(index),
  udid: `fixture-${index}`,
  deviceName: "Acceptance",
});
test("cloud device inventory uses the provider totalCount, visits all pages, and rejects inconsistent inventories", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "deveco-cloud-inventory-"),
  );
  const store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes);
  const signatures = new SignatureService(processes, store, auth);
  t.mock.method(auth, "credentials", async () => ({
    jwt: "fixture",
    access: "fixture",
    saved: Date.now(),
    userId: "fixture",
    userName: "Fixture",
  }));
  let pages: unknown[] = [],
    requests: number[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/api/cps/device-manage/v1/device/list");
      assert.equal(options?.method, "GET");
      assert.equal(url.searchParams.get("pageSize"), "100");
      const page = Number(url.searchParams.get("start"));
      requests.push(page);
      assert.ok(
        page <= pages.length,
        "Must stop when the response is invalid or complete",
      );
      return Response.json(pages[page - 1]);
    },
  );
  try {
    pages = [
      {
        ret: { code: 0 },
        totalCount: 102,
        list: Array.from({ length: 100 }, (_, i) => device(i)),
      },
      { ret: { code: 0 }, totalCount: 102, list: [device(100), device(101)] },
    ];
    assert.deepEqual(
      await signatures.call({ action: "devices", team_id: "fixture" }),
      { devices: Array.from({ length: 102 }, (_, i) => device(i)) },
    );
    assert.deepEqual(requests, [1, 2]);
    requests = [];
    pages = [{ ret: { code: 0 }, totalCount: 0, list: [] }];
    assert.deepEqual(
      await signatures.call({ action: "devices", team_id: "fixture" }),
      { devices: [] },
    );
    assert.deepEqual(requests, [1]);
    const cases = [
      {
        pages: [{ total: 1, list: [device(1)] }],
        code: "SIGN_CLOUD_RESPONSE_INVALID",
      },
      {
        pages: [{ totalCount: "1", list: [device(1)] }],
        code: "SIGN_CLOUD_RESPONSE_INVALID",
      },
      {
        pages: [
          { totalCount: 2, list: [device(1)] },
          { totalCount: 2, list: [device(1)] },
        ],
        code: "SIGN_PAGINATION_INVALID",
      },
      {
        pages: [
          { totalCount: 2, list: [device(1)] },
          { totalCount: 2, list: [] },
        ],
        code: "SIGN_PAGINATION_INVALID",
      },
      {
        pages: [
          { totalCount: 2, list: [device(1)] },
          { totalCount: 3, list: [device(2)] },
        ],
        code: "SIGN_INVENTORY_CHANGED",
      },
      {
        pages: [{ totalCount: 0, list: [device(1)] }],
        code: "SIGN_PAGINATION_INVALID",
      },
      {
        pages: [{ ret: { code: 9 }, totalCount: 0, list: [] }],
        code: "SIGN_CLOUD_REJECTED",
      },
    ];
    for (const scenario of cases) {
      requests = [];
      pages = scenario.pages;
      await assert.rejects(
        signatures.call({ action: "devices", team_id: "fixture" }),
        { code: scenario.code },
      );
    }
  } finally {
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
