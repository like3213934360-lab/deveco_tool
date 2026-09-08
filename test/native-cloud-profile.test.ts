import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { AuthService } from "../src/services/auth.js";
import { SignatureService } from "../src/services/signature.js";
import { errorResult } from "../src/core/errors.js";

test("debug profiles use the modern test route and distinguish request, URL and download failures without leaking credentials", async (t) => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-cloud-profile-")),
  );
  const store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes);
  const signatures = new SignatureService(processes, store, auth);
  t.mock.method(auth, "credentials", async () => ({
    jwt: "private-jwt",
    access: "private-access",
    saved: Date.now(),
    userId: "private-user",
    userName: "Fixture",
  }));
  const payload = Buffer.from("fixture profile"),
    sha256 = crypto.createHash("sha256").update(payload).digest("hex");
  let omitId = false,
    failAt = "",
    calls: string[] = [],
    cancelled = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      const stage = url.pathname.endsWith("/provision/add")
        ? "cloud_request"
        : url.pathname.endsWith("/reapply")
          ? "download_url"
          : "download_file";
      calls.push(stage);
      if (stage === "cloud_request") {
        assert.equal(
          url.pathname,
          "/api/cps/provision-manage/v1/ide/test/provision/add",
        );
        assert.equal(options?.method, "POST");
        assert.deepEqual(JSON.parse(String(options?.body)), {
          certList: ["cert"],
          packageName: "com.example.acceptance",
          deviceList: ["device"],
          provisionName: "Acceptance",
        });
      }
      if (stage === failAt)
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { status: 403 },
        );
      if (stage === "cloud_request")
        return Response.json({
          ret: { code: 0 },
          ...(omitId ? {} : { id: "profile" }),
          provisionFileUrl: "private-source",
        });
      if (stage === "download_url")
        return Response.json({
          urlsInfo: [
            {
              newUrl: "https://download.example/profile?token=private-token",
              sha256,
            },
          ],
        });
      return new Response(payload);
    },
  );
  try {
    for (const stage of [
      "cloud_request",
      "download_url",
      "download_file",
      "",
    ]) {
      failAt = stage;
      calls = [];
      const output = path.join(root, `${stage || "success"}.p7b`);
      const request = signatures.call({
        action: "profile_create",
        team_id: "team",
        output,
        options: {
          cert_ids: '["cert"]',
          device_ids: '["device"]',
          bundle_name: "com.example.acceptance",
          profile_name: "Acceptance",
        },
      });
      if (stage) {
        await assert.rejects(request, (error: unknown) => {
          const result = errorResult(error);
          assert.equal(result.code, "HTTP_ERROR");
          assert.deepEqual(result.details, { status: 403, stage });
          assert.doesNotMatch(
            JSON.stringify(result),
            /private-|download.example/,
          );
          return true;
        });
        assert.equal(fs.existsSync(output), false);
        assert.equal(
          calls.filter((call) => call === stage).length,
          1,
          "No implicit mutation retries",
        );
        assert.equal(calls.at(-1), stage);
      } else {
        assert.deepEqual(await request, {
          profile_id: "profile",
          remote_deletion_available: true,
          path: output,
          sha256,
          bytes: payload.length,
        });
        assert.deepEqual(fs.readFileSync(output), payload);
      }
    }
    omitId = true;
    const temporary = await signatures.call({
      action: "profile_create",
      team_id: "team",
      output: path.join(root, "temporary.p7b"),
      options: {
        cert_ids: '["cert"]',
        device_ids: '["device"]',
        bundle_name: "com.example.acceptance",
        profile_name: "Acceptance",
      },
    });
    assert.deepEqual(temporary, {
      remote_deletion_available: false,
      path: path.join(root, "temporary.p7b"),
      sha256,
      bytes: payload.length,
    });
    assert.equal(
      cancelled,
      3,
      "Rejected HTTP bodies must release their streams",
    );
  } finally {
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
