import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ProcessService } from "../src/core/process.js";
import {
  LanguageService,
  languagePosition,
  languageResult,
} from "../src/services/lsp.js";
import { ToolError } from "../src/core/errors.js";
import type { Project } from "../src/services/project.js";
import { tools } from "../src/core/contracts.js";
import { PassThrough, Writable } from "node:stream";
import { languageConnection } from "../src/core/language-connection.js";

test("LSP broken pipes reject pending requests and notifications without unhandled writes", async () => {
  for (const [notification, failedWrite] of [
    [false, 1],
    [false, 2],
    [true, 1],
    [true, 2],
  ] as const) {
    const input = new PassThrough();
    let writes = 0;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        // Exercise failure before any header and after a header was sent.
        callback(
          ++writes === failedWrite
            ? new Error("broken language-server pipe")
            : undefined,
        );
      },
    });
    const connection = languageConnection(input, output);
    connection.listen();
    try {
      if (notification) {
        await assert.rejects(
          connection.sendNotification("initialized", {}),
          /broken language-server pipe/,
        );
      } else {
        const requests = [
          connection.sendRequest("initialize", {}),
          connection.sendRequest("initialize", {}),
        ];
        const results = await Promise.allSettled(requests);
        assert.ok(results.every((result) => result.status === "rejected"));
      }
      assert.throws(() => connection.sendRequest("initialize", {}), /disposed/);
    } finally {
      connection.dispose();
      input.destroy();
      output.destroy();
    }
  }
});

const code = (expected: string) => (error: unknown) =>
  error instanceof ToolError && error.code === expected;
async function fixture(
  env: Record<string, string>,
  check: (service: LanguageService, project: Project) => Promise<void>,
  expectedCloseFailure?: string,
) {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-lsp-boundary-中文 ")),
    ),
    processes = new ProcessService(),
    service = new LanguageService(processes, (project) => ({
      executable: process.execPath,
      args: [
        fileURLToPath(new URL("./fixtures/native-lsp.js", import.meta.url)),
      ],
      cwd: project.root,
      env: { ...process.env, ...env },
    })),
    project: Project = {
      root,
      product: {
        name: "default",
        compatibleSdkVersion: "26.0.0",
        runtimeOS: "HarmonyOS",
      },
      modules: [],
      fingerprint: "fixture",
    };
  fs.writeFileSync(
    path.join(root, "Model.ets"),
    "const value = '中文😀';\r\nvalue\r\n",
  );
  try {
    await check(service, project);
  } finally {
    if (expectedCloseFailure)
      await assert.rejects(service.close(), code(expectedCloseFailure));
    else await service.close();
    await processes.close();
    assert.equal(processes.size, 0);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test("LSP refuses deleted sources and refreshes recreated files in the existing session", async () => {
  await fixture({}, async (service, project) => {
    await service.request(project, { action: "hover", file: "Model.ets" });
    const file = path.join(project.root, "Model.ets");
    fs.rmSync(file);
    await assert.rejects(
      service.request(project, { action: "hover", file: "Model.ets" }),
    );
    fs.writeFileSync(file, "const recreated = '新的内容';\n");
    const hover = await service.request(project, {
      action: "hover",
      file: "Model.ets",
    });
    assert.match(JSON.stringify(hover), /recreated/);
    assert.doesNotMatch(JSON.stringify(hover), /const value/);
    assert.equal(service.metrics.connections, 1);
  });
});

test("LSP implementation returns location links and resolves Unicode path aliases once", async () => {
  assert.equal(
    tools.lsp.schema.parse({ action: "implementation", file: "Model.ets" })
      .line,
    0,
  );
  await fixture({}, async (service, project) => {
    const result = await service.request(project, {
      action: "implementation",
      file: "./Model.ets",
    });
    const links = z
      .array(
        z.object({
          targetUri: z.string(),
          targetRange: z.unknown(),
          targetSelectionRange: z.unknown(),
        }),
      )
      .parse(result);
    assert.match(links[0]!.targetUri, /Implementation\.ets/);
    await service.request(project, {
      action: "hover",
      file: path.join(project.root, "Model.ets"),
    });
    const hover = z.object({ contents: z.string() }).parse(
      await service.request(project, {
        action: "hover",
        file: "./Model.ets",
      }),
    );
    const documents = z
      .object({
        documents: z.array(z.object({ uri: z.string(), version: z.number() })),
      })
      .parse(JSON.parse(hover.contents) as unknown);
    assert.equal(documents.documents.length, 1);
    assert.equal(documents.documents[0]!.version, 1);
  });
});
test("LSP positions validate UTF-16, CRLF, lone CR and final empty lines", async () => {
  const text = "中😀\r\nab\rc\n";
  assert.deepEqual(languagePosition(text, 0, 3), { line: 0, character: 3 });
  assert.deepEqual(languagePosition(text, 3, 0), { line: 3, character: 0 });
  assert.deepEqual(languagePosition("", 0, 0), { line: 0, character: 0 });
  for (const [line, character] of [
    [0, 4],
    [1, 3],
    [2, 2],
    [4, 0],
    [-1, 0],
    [0, 0.5],
  ])
    assert.throws(
      () => languagePosition(text, line, character),
      code("LSP_INVALID_POSITION"),
    );
  await fixture({}, async (service, project) => {
    await assert.rejects(
      service.request(project, {
        action: "hover",
        file: "Model.ets",
        line: 100,
      }),
      code("LSP_INVALID_POSITION"),
    );
    const result = await service.request(project, {
      action: "hover",
      file: "Model.ets",
      line: 1,
      character: 5,
    });
    assert.ok(result);
  });
});

test("LSP symbols retain hierarchy, cross-file locations and workspace query scope", async () => {
  await fixture({}, async (service, project) => {
    const document = z
      .array(
        z.object({
          name: z.string(),
          children: z.array(z.object({ name: z.string() })),
        }),
      )
      .parse(
        await service.request(project, {
          action: "documentSymbol",
          file: "Model.ets",
          line: 99999,
        }),
      );
    assert.equal(document[0]!.children[0]!.name, "nested");
    const workspace = z
      .array(
        z.object({ name: z.string(), location: z.object({ uri: z.string() }) }),
      )
      .parse(
        await service.request(project, {
          action: "workspaceSymbol",
          file: "Model.ets",
          query: "中文Query",
        }),
      );
    assert.equal(workspace[0]!.name, "中文Query");
    assert.match(workspace[0]!.location.uri, /Consumer\.ets$/);
  });
  await fixture({ FLAT_SYMBOLS: "1" }, async (service, project) => {
    assert.match(
      JSON.stringify(
        await service.request(project, {
          action: "documentSymbol",
          file: "Model.ets",
        }),
      ),
      /flat/,
    );
  });
});

test("LSP call edges preserve opaque data, multiple ranges and selected overload after changes", async () => {
  await fixture({}, async (service, project) => {
    const input = { file: "Model.ets", line: 1, character: 1 };
    const items = z.array(z.object({ name: z.string() })).parse(
      await service.request(project, {
        ...input,
        action: "prepareCallHierarchy",
      }),
    );
    assert.deepEqual(
      items.map((item) => item.name),
      ["root", "overload"],
    );
    fs.writeFileSync(
      path.join(project.root, input.file),
      "const fresh = '新😀';\r\nfresh\n",
    );
    for (const action of ["incomingCalls", "outgoingCalls"] as const) {
      const result = z
        .array(z.object({ fromRanges: z.array(z.unknown()) }).passthrough())
        .parse(
          await service.request(project, { ...input, action, item_index: 1 }),
        );
      assert.equal(result.length, 2);
      assert.equal(result[0]!.fromRanges.length, 2);
      assert.match(JSON.stringify(result), /overload-one/);
      assert.match(JSON.stringify(result), /Consumer\.ets/);
      assert.match(JSON.stringify(result), /fresh/);
    }
    await assert.rejects(
      service.request(project, {
        ...input,
        action: "incomingCalls",
        item_index: 2,
      }),
      code("LSP_CALL_ITEM_NOT_FOUND"),
    );
  });
});

test("LSP symbol absence, empty results and malformed responses remain distinct", async () => {
  const actions = [
    "documentSymbol",
    "workspaceSymbol",
    "prepareCallHierarchy",
    "incomingCalls",
    "outgoingCalls",
  ] as const;
  await fixture({ NO_SYMBOLS: "1" }, async (service, project) => {
    for (const action of actions)
      await assert.rejects(
        service.request(project, { action, file: "Model.ets" }),
        code("LSP_CAPABILITY_UNAVAILABLE"),
      );
  });
  await fixture({ EMPTY_SYMBOLS: "1" }, async (service, project) => {
    for (const action of actions) {
      const result = await service.request(project, {
        action,
        file: "Model.ets",
      });
      assert.ok(
        result === null || (Array.isArray(result) && result.length === 0),
      );
    }
  });
  await fixture({ INVALID_SYMBOLS: "1" }, async (service, project) => {
    await assert.rejects(
      service.request(project, { action: "documentSymbol", file: "Model.ets" }),
      code("LSP_INVALID_RESPONSE"),
    );
  });
  assert.throws(
    () =>
      languageResult("incomingCalls", [
        { from: { name: "missing location" }, fromRanges: [] },
      ]),
    code("LSP_INVALID_RESPONSE"),
  );
  assert.throws(
    () =>
      languageResult("workspaceSymbol", [
        { name: "missing range", kind: 12, location: { uri: "file:///a" } },
      ]),
    code("LSP_INVALID_RESPONSE"),
  );
});

test("LSP symbol validation bounds nesting and output before recursive parsing", () => {
  let nested: unknown = [];
  for (let depth = 0; depth < 100; depth++) nested = [{ children: nested }];
  assert.throws(
    () => languageResult("documentSymbol", nested),
    code("LSP_RESULT_LIMIT"),
  );
  assert.throws(
    () =>
      languageResult("hover", { contents: "x".repeat(4 * 1024 * 1024 + 1) }),
    code("LSP_RESULT_LIMIT"),
  );
  assert.equal(
    tools.lsp.schema.safeParse({
      action: "hover",
      file: "Model.ets",
      query: "no",
    }).success,
    false,
  );
  assert.equal(
    tools.lsp.schema.safeParse({
      action: "documentSymbol",
      file: "Model.ets",
      item_index: 0,
    }).success,
    false,
  );
});

test("LSP coarse advertised capability does not disguise a missing call method as an internal failure", async () => {
  await fixture({ NO_OUTGOING_METHOD: "1" }, async (service, project) => {
    await assert.rejects(
      service.request(project, { action: "outgoingCalls", file: "Model.ets" }),
      (error: unknown) =>
        error instanceof ToolError &&
        error.code === "LSP_CAPABILITY_UNAVAILABLE" &&
        /callHierarchy\/outgoingCalls/.test(error.message),
    );
    assert.ok(
      Array.isArray(
        await service.request(project, {
          action: "incomingCalls",
          file: "Model.ets",
        }),
      ),
    );
  });
});

test("LSP call cancellation releases the queue and does not poison the next request", async () => {
  await fixture({ CALL_DELAY_MS: "10000" }, async (service, project) => {
    await service.request(project, {
      action: "prepareCallHierarchy",
      file: "Model.ets",
    });
    const controller = new AbortController();
    const cancelled = service.request(
      project,
      { action: "outgoingCalls", file: "Model.ets" },
      controller.signal,
    );
    const timer = setTimeout(
      () => controller.abort(new Error("cancel call query")),
      100,
    );
    try {
      await assert.rejects(cancelled, /cancel call query/);
    } finally {
      clearTimeout(timer);
    }
    const result = await service.request(project, {
      action: "documentSymbol",
      file: "Model.ets",
    });
    assert.ok(Array.isArray(result));
  });
});
test("LSP unsupported capabilities, empty hover, invalid encoding and malformed results remain distinct", async () => {
  await fixture({ NO_IMPLEMENTATION: "1" }, async (service, project) => {
    await assert.rejects(
      service.request(project, { action: "implementation", file: "Model.ets" }),
      code("LSP_CAPABILITY_UNAVAILABLE"),
    );
    assert.ok(
      await service.request(project, { action: "hover", file: "Model.ets" }),
    );
  });
  await fixture({ EMPTY_HOVER: "1" }, async (service, project) => {
    assert.equal(
      await service.request(project, { action: "hover", file: "Model.ets" }),
      null,
    );
  });
  await fixture({ POSITION_ENCODING: "utf-8" }, async (service, project) => {
    await assert.rejects(
      service.request(project, { action: "hover", file: "Model.ets" }),
      code("LSP_POSITION_ENCODING_UNSUPPORTED"),
    );
  });
  await fixture({ INVALID_RESULT: "1" }, async (service, project) => {
    await assert.rejects(
      service.request(project, { action: "hover", file: "Model.ets" }),
      code("LSP_INVALID_RESPONSE"),
    );
  });
  assert.throws(
    () => languageResult("references", [{ uri: "file:///a", range: {} }]),
    code("LSP_INVALID_RESPONSE"),
  );
  assert.equal(languageResult("definition", null), null);
  assert.deepEqual(languageResult("hover", { contents: [] }), { contents: [] });
  assert.deepEqual(languageResult("implementation", []), []);
});
test("LSP refreshes the exact changed bytes and ignores old-version or invalid-URI diagnostics", async () => {
  await fixture({}, async (service, project) => {
    const first = await service.request(project, {
      action: "diagnostics",
      file: "Model.ets",
    });
    assert.deepEqual(
      z.object({ diagnostics: z.array(z.unknown()) }).parse(first).diagnostics,
      [],
    );
    fs.writeFileSync(path.join(project.root, "Model.ets"), "BROKEN");
    const changed = await service.request(project, {
      action: "diagnostics",
      file: "Model.ets",
    });
    assert.deepEqual(
      z
        .object({ diagnostics: z.array(z.object({ message: z.string() })) })
        .parse(changed)
        .diagnostics.map((x) => x.message),
      ["current diagnostic"],
    );
    fs.writeFileSync(path.join(project.root, "Model.ets"), "fixed");
    const fixed = await service.request(project, {
      action: "diagnostics",
      file: "Model.ets",
    });
    assert.deepEqual(
      z.object({ diagnostics: z.array(z.unknown()) }).parse(fixed).diagnostics,
      [],
    );
    await assert.rejects(
      service.request(project, { action: "hover", file: "." }),
      code("LSP_FILE_INVALID"),
    );
  });
});

test("LSP reads fresh bytes across chunk boundaries and rejects oversized files", async () => {
  await fixture({}, async (service, project) => {
    const file = path.join(project.root, "Model.ets");
    for (const size of [1024, 65536, 65537]) {
      fs.writeFileSync(file, "fixed!".padEnd(size, " "));
      const before = fs.statSync(file);
      const read = async () =>
        z
          .object({ diagnostics: z.array(z.object({ message: z.string() })) })
          .parse(
            await service.request(project, { action: "diagnostics", file }),
          ).diagnostics;
      assert.deepEqual(await read(), []);
      fs.writeFileSync(file, "BROKEN".padEnd(size, " "));
      fs.utimesSync(file, before.atime, before.mtime);
      assert.deepEqual(
        (await read()).map((item) => item.message),
        ["current diagnostic"],
      );
    }
    fs.writeFileSync(file, Buffer.alloc(4 * 1024 * 1024 + 1));
    await assert.rejects(
      service.request(project, { action: "hover", file }),
      code("LSP_FILE_TOO_LARGE"),
    );
  });
});

test("LSP recycles an idle session only after confirmed exit and shares concurrent admission", async () => {
  await fixture({}, async (service, project) => {
    const request = (fingerprint: string, signal?: AbortSignal) =>
      service.request(
        { ...project, fingerprint },
        { action: "definition", file: "Model.ets" },
        signal,
      );
    for (let index = 0; index < 4; index++) await request(`product-${index}`);
    assert.equal(service.metrics.connections, 4);
    const processes = service.processes,
      terminate = processes.terminate.bind(processes),
      started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    let exits = 0;
    processes.terminate = async (...args) => {
      exits++;
      started.resolve();
      await release.promise;
      return terminate(...args);
    };
    const pending = Array.from({ length: 8 }, () => request("next-product"));
    const settled = Promise.allSettled(pending);
    try {
      await Promise.race([started.promise, settled]);
      assert.equal(
        exits,
        1,
        "One idle owner should be selected for confirmed reclamation",
      );
      assert.equal(
        processes.metrics.process_starts,
        4,
        "No replacement before exit confirmation",
      );
      assert.equal(service.metrics.connections, 4);
    } finally {
      release.resolve();
    }
    try {
      const results = await settled;
      assert.ok(
        results.every((result) => result.status === "fulfilled"),
        JSON.stringify(results),
      );
      assert.equal(exits, 1);
      assert.equal(
        processes.metrics.process_starts,
        5,
        "Concurrent same-key requests share one replacement",
      );
      assert.equal(service.metrics.connections, 4);
      assert.equal(service.metrics.active_requests, 0);
    } finally {
      processes.terminate = terminate;
    }
  });
});

test("LSP capacity preserves four active sessions and rejects a fifth until work settles", async () => {
  await fixture({ HOVER_DELAY_MS: "5000" }, async (service, project) => {
    const controller = new AbortController();
    const pending = Array.from({ length: 4 }, (_, index) =>
      service.request(
        { ...project, fingerprint: `active-${index}` },
        { action: "hover", file: "Model.ets" },
        controller.signal,
      ),
    );
    const settled = Promise.allSettled(pending);
    try {
      const deadline = Date.now() + 10000;
      // Session slots are reserved before the OS emits child `spawn`. Observe
      // both events before asserting the number of started processes.
      while (
        service.metrics.active_requests < 4 ||
        service.processes.metrics.process_starts < 4
      ) {
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await assert.rejects(
        service.request(
          { ...project, fingerprint: "fifth" },
          { action: "hover", file: "Model.ets" },
        ),
        code("LSP_CAPACITY"),
      );
      assert.equal(service.processes.metrics.process_starts, 4);
      assert.equal(service.metrics.active_requests, 4);
    } finally {
      controller.abort();
      await settled;
    }
    assert.equal(service.metrics.active_requests, 0);
  });
});

test("LSP keeps an unconfirmed idle owner quarantined instead of reusing its slot", async () => {
  await fixture(
    {},
    async (service, project) => {
      const request = (fingerprint: string) =>
        service.request(
          { ...project, fingerprint },
          { action: "definition", file: "Model.ets" },
        );
      for (let index = 0; index < 4; index++) await request(`owner-${index}`);
      const processes = service.processes,
        terminate = processes.terminate.bind(processes);
      processes.terminate = async () => {
        throw new ToolError(
          "CANCEL_UNCONFIRMED",
          "Acceptance cannot confirm owner exit",
        );
      };
      try {
        await assert.rejects(
          request("replacement"),
          code("CANCEL_UNCONFIRMED"),
        );
        assert.equal(service.metrics.connections, 4);
        assert.equal(processes.metrics.process_starts, 4);
        assert.equal(processes.size, 4);
        await assert.rejects(request("owner-0"), code("LSP_CLOSING"));
      } finally {
        processes.terminate = terminate;
      }
    },
    "CANCEL_UNCONFIRMED",
  );
});
