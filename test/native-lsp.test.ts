import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import {
  arktsSymbolResult,
  reconcileArktsOutgoing,
  reconcileArktsCallableExtents,
} from "../src/services/arkts-language.js";

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
  for (const name of ["Consumer.ets", "Implementation.ets"])
    fs.writeFileSync(
      path.join(root, name),
      "export function leaf(): number { return 1; }\n",
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
    for (const action of actions) {
      assert.ok(
        Array.isArray(
          await service.request(project, { action, file: "Model.ets" }),
        ),
      );
      await assert.rejects(
        service.request(project, {
          action,
          file: "Model.ets",
          language: "cpp",
        }),
        code("LSP_CAPABILITY_UNAVAILABLE"),
      );
    }
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

test("ArkTS symbol normalization preserves opaque data and rejects relative paths", () => {
  for (const file of [
    "/tmp/中文 #%.ets",
    "C:\\工程\\文件 #.ets",
    "\\\\server\\share\\文件.ets",
    "file:///tmp/中文 空格.ets",
    "file:///tmp/encoded%20space.ets",
  ]) {
    const data = { uri: "opaque:unchanged", path: file };
    const value = [
      {
        name: "leaf",
        kind: 12,
        location: {
          uri: file,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
        data,
      },
    ];
    const normalized = arktsSymbolResult(
      "workspaceSymbol",
      value,
    ) as typeof value;
    assert.match(normalized[0]!.location.uri, /^file:\/\//);
    assert.equal(normalized[0]!.location.uri.includes(" "), false);
    assert.equal(normalized[0]!.data, data);
    assert.deepEqual(
      arktsSymbolResult("workspaceSymbol", normalized),
      normalized,
    );
    assert.ok(languageResult("workspaceSymbol", normalized));
  }
  for (const uri of ["relative.ets", "C:relative.ets", "bad\0path"]) {
    assert.throws(
      () =>
        languageResult(
          "prepareCallHierarchy",
          arktsSymbolResult("prepareCallHierarchy", [
            {
              uri,
              name: "leaf",
              kind: 12,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
              selectionRange: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ]),
        ),
      code("LSP_INVALID_RESPONSE"),
    );
  }
});

test("ArkTS named-arrow extents require the exact semantic variable declaration and keep original coordinates", async () => {
  const item = {
    name: "nested",
    kind: 12,
    uri: "file:///owned/Caller.ets",
    range: {
      start: { line: 8, character: 31 },
      end: { line: 8, character: 84 },
    },
    selectionRange: {
      start: { line: 8, character: 8 },
      end: { line: 8, character: 14 },
    },
    data: { opaque: "server-owned" },
  };
  const fromRanges = [
    { start: { line: 8, character: 54 }, end: { line: 8, character: 63 } },
  ];
  for (const action of [
    "prepareCallHierarchy",
    "incomingCalls",
    "outgoingCalls",
  ] as const) {
    const field =
      action === "incomingCalls"
        ? "from"
        : action === "outgoingCalls"
          ? "to"
          : undefined;
    const response = field ? [{ [field]: item, fromRanges }] : [item];
    let checks = 0;
    const reconciled = await reconcileArktsCallableExtents(
      action,
      response,
      async (candidate) => {
        checks++;
        assert.deepEqual(candidate, item);
        return true;
      },
    );
    assert.equal(checks, 1);
    const validated = languageResult(action, reconciled) as Record<
      string,
      unknown
    >[];
    const resolved = (
      field ? validated[0]![field] : validated[0]
    ) as typeof item & { extentEvidence: unknown };
    assert.deepEqual(resolved.range, {
      start: item.selectionRange.start,
      end: item.range.end,
    });
    assert.deepEqual(resolved.selectionRange, item.selectionRange);
    assert.deepEqual(resolved.data, item.data);
    assert.deepEqual(resolved.extentEvidence, {
      method: "textDocument/documentSymbol",
      originalRange: item.range,
      declarationRange: item.selectionRange,
    });
    if (field) assert.deepEqual(validated[0]!.fromRanges, fromRanges);
    await assert.rejects(
      reconcileArktsCallableExtents(action, response, async () => false),
      code("LSP_CALL_EXTENT_UNVERIFIED"),
    );
  }
  for (const altered of [
    { ...item, kind: 5 },
    {
      ...item,
      selectionRange: {
        start: { line: 8, character: 80 },
        end: { line: 8, character: 90 },
      },
    },
    {
      ...item,
      range: {
        start: { line: 8, character: 84 },
        end: { line: 8, character: 31 },
      },
    },
  ]) {
    const response = await reconcileArktsCallableExtents(
      "prepareCallHierarchy",
      [altered],
      async () => {
        assert.fail("Invalid shapes must not trigger declaration queries");
      },
    );
    assert.throws(
      () => languageResult("prepareCallHierarchy", response),
      code("LSP_INVALID_RESPONSE"),
    );
  }
  // Language-neutral validation remains strict; only the evidenced ArkTS path adapts.
  assert.throws(
    () => languageResult("prepareCallHierarchy", [item]),
    code("LSP_INVALID_RESPONSE"),
  );
});

test("ArkTS duplicated property-call spans reconcile against the same precise incoming relation", async () => {
  const point = (character: number) => ({ line: 1, character });
  const range = (start: number, end: number) => ({
    start: point(start),
    end: point(end),
  });
  const caller = {
    name: "relay",
    kind: 12,
    uri: "file:///owned/Caller.ets",
    range: range(0, 100),
    selectionRange: range(0, 5),
  };
  for (const uri of [caller.uri, "file:///owned/Callee.ets"]) {
    const callee = {
      ...caller,
      uri,
      name: "compute",
      selectionRange: range(5, 12),
    };
    const original = [
      range(20, 32),
      range(20, 32),
      range(40, 52),
      range(40, 52),
    ];
    const expected = [range(25, 32), range(45, 52)];
    const resolved = await reconcileArktsOutgoing(
      caller,
      [{ to: callee, fromRanges: original }],
      async () => [{ from: caller, fromRanges: expected }],
    );
    assert.deepEqual(resolved?.[0]?.fromRanges, expected);
    assert.deepEqual(
      z
        .object({
          rangeEvidence: z.object({ originalFromRanges: z.unknown() }),
        })
        .parse(resolved?.[0]).rangeEvidence.originalFromRanges,
      original,
    );
    await assert.rejects(
      reconcileArktsOutgoing(
        caller,
        [{ to: callee, fromRanges: original }],
        async () => [{ from: caller, fromRanges: [expected[0]!] }],
      ),
      code("LSP_CALL_RANGE_UNVERIFIED"),
    );
  }
});

test("ArkTS cross-file calls use reciprocal semantic ranges and refuse incomplete relations", async () => {
  const range = (line: number, character: number) => ({
    start: { line, character },
    end: { line, character: character + 3 },
  });
  const caller = {
    name: "caller",
    kind: 12,
    uri: pathToFileURL("/tmp/caller.ets").href,
    range: range(4, 0),
    selectionRange: range(4, 0),
  };
  const callee = {
    ...caller,
    name: "leaf",
    uri: pathToFileURL("/tmp/leaf.ets").href,
  };
  const original = [{ to: callee, fromRanges: [range(1, 0), range(1, 8)] }];
  const correct = [range(9, 12), range(10, 6)];
  const result = await reconcileArktsOutgoing(caller, original, async () => [
    { from: caller, fromRanges: correct },
  ]);
  assert.deepEqual(result![0]!.fromRanges, correct);
  assert.deepEqual(result![0], {
    to: callee,
    fromRanges: correct,
    rangeEvidence: {
      method: "callHierarchy/incomingCalls",
      originalFromRanges: original[0]!.fromRanges,
    },
  });
  for (const response of [
    null,
    [],
    [{ from: { ...caller, uri: callee.uri }, fromRanges: correct }],
    [{ from: caller, fromRanges: correct.slice(0, 1) }],
  ])
    await assert.rejects(
      reconcileArktsOutgoing(caller, original, async () => response),
      code("LSP_CALL_RANGE_UNVERIFIED"),
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

test("LSP discovery separates declared support, validated observations and independent language sessions", async () => {
  await fixture({ NO_SYMBOLS: "1" }, async (service, project) => {
    assert.deepEqual(service.capabilityReport().sessions, []);
    assert.equal(service.capabilityReport().acceptance_verified, false);
    await service.request(project, { action: "documentSymbol", file: "Model.ets" });
    await service.request(project, { action: "diagnostics", file: "Model.ets" });
    await assert.rejects(service.request(project, { action: "documentSymbol", file: "Model.ets", language: "cpp" }), code("LSP_CAPABILITY_UNAVAILABLE"));
    const sessions = service.capabilityReport().sessions;
    const arkts = sessions.find(session => session.language === "arkts")!, cpp = sessions.find(session => session.language === "cpp")!;
    assert.equal(arkts.project_fingerprint, project.fingerprint);
    const symbols = arkts.operations.find(operation => operation.operation === "documentSymbol")!;
    assert.equal(symbols.declaration, "absent");
    assert.equal(symbols.adapter, "arkts_symbol_probe");
    assert.equal(symbols.observation.outcome, "executed");
    assert.equal(arkts.operations.find(operation => operation.operation === "outgoingCalls")!.observation.outcome, "not_observed");
    const diagnostics = arkts.operations.find(operation => operation.operation === "diagnostics")!.observation;
    assert.ok("request_dispatched" in diagnostics);
    assert.equal(diagnostics.request_dispatched, false);
    assert.equal(cpp.operations.find(operation => operation.operation === "documentSymbol")!.observation.outcome, "unsupported");
    await service.close();
    assert.deepEqual(service.capabilityReport().sessions, []);
  });
  await fixture({ EMPTY_SYMBOLS: "1" }, async (service, project) => {
    assert.deepEqual(await service.request(project, { action: "outgoingCalls", file: "Model.ets" }), []);
    const operations = service.capabilityReport().sessions[0]!.operations;
    assert.equal(operations.find(operation => operation.operation === "prepareCallHierarchy")!.observation.outcome, "executed");
    assert.equal(operations.find(operation => operation.operation === "outgoingCalls")!.observation.outcome, "not_observed");
  });
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
test("LSP pull diagnostics return fresh full reports without waiting for push notifications", async () => {
  await fixture({ PULL_DIAGNOSTICS: "1" }, async (service, project) => {
    const read = async () =>
      z
        .object({
          diagnostic_transport: z.literal("pull"),
          diagnostics: z.array(
            z.object({ message: z.string(), severity: z.number().optional() }),
          ),
        })
        .parse(
          await service.request(project, {
            action: "diagnostics",
            file: "Model.ets",
          }),
        );
    assert.deepEqual((await read()).diagnostics, []);
    fs.writeFileSync(path.join(project.root, "Model.ets"), "BROKEN\n");
    assert.deepEqual((await read()).diagnostics, [
      { message: "current pull diagnostic", severity: 1 },
    ]);
    fs.writeFileSync(
      path.join(project.root, "Model.ets"),
      "const repaired = 1;\n",
    );
    assert.deepEqual((await read()).diagnostics, []);
    assert.equal(service.metrics.connections, 1);
  });
});
test("LSP pull diagnostic errors, invalid unchanged reports and cancellation never become empty success", async () => {
  for (const invalid of ["1", "null", "unchanged"])
    await fixture(
      { PULL_DIAGNOSTICS: "1", INVALID_DIAGNOSTICS: invalid },
      async (service, project) => {
        await assert.rejects(
          service.request(project, {
            action: "diagnostics",
            file: "Model.ets",
          }),
          code("LSP_INVALID_RESPONSE"),
        );
      },
    );
  await fixture(
    { PULL_DIAGNOSTICS: "1", NO_DIAGNOSTIC_METHOD: "1" },
    async (service, project) => {
      await assert.rejects(
        service.request(project, { action: "diagnostics", file: "Model.ets" }),
        (error) => {
          assert.ok(
            error instanceof ToolError &&
              error.code === "LSP_CAPABILITY_UNAVAILABLE",
          );
          assert.deepEqual(error.details, {
            method: "textDocument/diagnostic",
            rpc_code: -32601,
            source: "jsonrpc_response",
            request_dispatched: true,
          });
          return true;
        },
      );
    },
  );
  await fixture(
    { PULL_DIAGNOSTICS: "1", DIAGNOSTIC_DELAY_MS: "10000" },
    async (service, project) => {
      await service.request(project, { action: "hover", file: "Model.ets" });
      const controller = new AbortController(),
        reason = new ToolError("CANCELLED", "Cancel diagnostic pull");
      const timer = setTimeout(() => controller.abort(reason), 100);
      try {
        await assert.rejects(
          service.request(
            project,
            { action: "diagnostics", file: "Model.ets" },
            controller.signal,
          ),
          code("CANCELLED"),
        );
      } finally {
        clearTimeout(timer);
      }
      assert.ok(
        await service.request(project, { action: "hover", file: "Model.ets" }),
      );
      assert.equal(service.metrics.connections, 1);
    },
  );
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
