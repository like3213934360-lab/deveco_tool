import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import type { Runtime } from "../../src/services/runtime.js";
import { errorResult } from "../../src/core/errors.js";

export async function acceptLanguageSymbols(
  runtime: Runtime,
  project_path: string,
) {
  const provider = "entry/src/main/ets/SymbolProbe.ets";
  const consumer = "entry/src/main/ets/CallProbe.ets";
  assert.equal(
    fs.existsSync(path.join(project_path, provider)),
    false,
    "Probe must not replace an existing file",
  );
  assert.equal(
    fs.existsSync(path.join(project_path, consumer)),
    false,
    "Probe must not replace an existing file",
  );
  fs.writeFileSync(
    path.join(project_path, provider),
    "export function probeLeaf(value: number): number { return value + 1; }\n" +
      "export class SymbolProbe {\n  compute(value: number): number { return probeLeaf(value); }\n}\n",
  );
  fs.writeFileSync(
    path.join(project_path, consumer),
    "import { probeLeaf } from './SymbolProbe';\n" +
      "export function probeCaller(): number { return probeLeaf(1) + probeLeaf(2); }\n",
  );
  try {
    const check = await runtime.call("arkts_check", {
      project_path,
      files: [provider, consumer],
    });
    assert.equal(
      z.object({ summary: z.object({ errorCount: z.number() }) }).parse(check)
        .summary.errorCount,
      0,
    );
    const observations: Record<string, unknown> = {};
    const query = async (
      action:
        | "documentSymbol"
        | "workspaceSymbol"
        | "prepareCallHierarchy"
        | "incomingCalls"
        | "outgoingCalls",
      selectedFile = provider,
      line = 0,
      character = 20,
    ) => {
      try {
        const result = await runtime.call("lsp", {
          action,
          project_path,
          file: selectedFile,
          line,
          character,
          ...(action === "workspaceSymbol" ? { query: "SymbolProbe" } : {}),
        });
        assert.ok(result === null || Array.isArray(result));
        observations[action] = { supported: true, result };
        return result;
      } catch (error) {
        if (errorResult(error).code !== "LSP_CAPABILITY_UNAVAILABLE")
          throw error;
        observations[action] = { supported: false, reason: errorResult(error) };
        return undefined;
      }
    };
    await query("documentSymbol", consumer);
    const document = await query("documentSymbol");
    if (document !== undefined)
      assert.match(JSON.stringify(document), /probeLeaf|SymbolProbe/);
    const workspace = await query("workspaceSymbol");
    if (workspace !== undefined)
      assert.match(JSON.stringify(workspace), /SymbolProbe/);
    const prepared = await query("prepareCallHierarchy");
    if (prepared !== undefined)
      assert.match(JSON.stringify(prepared), /probeLeaf/);
    const incoming = await query("incomingCalls");
    if (incoming !== undefined)
      assert.match(JSON.stringify(incoming), /CallProbe\.ets/);
    const outgoing = await query("outgoingCalls", consumer, 1, 20);
    if (outgoing !== undefined)
      assert.match(JSON.stringify(outgoing), /probeLeaf/);
    return { check, operations: observations };
  } finally {
    fs.rmSync(path.join(project_path, provider));
    fs.rmSync(path.join(project_path, consumer));
  }
}

/** Real SDK clangd path. Run only in the isolated CMake acceptance project. */
export async function acceptCppSymbols(runtime: Runtime, project_path: string) {
  const file = "entry/src/main/cpp/native_canary.cpp",
    absolute = path.join(project_path, file);
  const original = fs.readFileSync(absolute, "utf8");
  assert.equal(
    original,
    "int native_value() { return 7; }\n",
    "Use the owned CMake acceptance canary",
  );
  fs.writeFileSync(
    absolute,
    "int probe_leaf(int value) { return value + 1; }\n" +
      "class SymbolProbe { public: int compute(int value) { return probe_leaf(value); } };\n" +
      "int probe_caller() { return probe_leaf(1) + probe_leaf(2); }\n",
  );
  try {
    const query = (
      action:
        | "documentSymbol"
        | "workspaceSymbol"
        | "prepareCallHierarchy"
        | "incomingCalls"
        | "outgoingCalls",
      line = 0,
      character = 8,
    ) => {
      process.stdout.write(`clangd ${action}\n`);
      return runtime.call("lsp", {
        action,
        project_path,
        file,
        line,
        character,
        language: "cpp",
        abi: "arm64-v8a",
        ...(action === "workspaceSymbol" ? { query: "probe_leaf" } : {}),
      });
    };
    const documentSymbol = await query("documentSymbol");
    assert.match(JSON.stringify(documentSymbol), /SymbolProbe/);
    assert.match(JSON.stringify(documentSymbol), /compute/);
    const workspaceSymbol = await query("workspaceSymbol");
    assert.match(JSON.stringify(workspaceSymbol), /probe_leaf/);
    const prepareCallHierarchy = await query("prepareCallHierarchy");
    assert.match(JSON.stringify(prepareCallHierarchy), /probe_leaf/);
    const incomingCalls = await query("incomingCalls");
    assert.match(JSON.stringify(incomingCalls), /probe_caller/);
    let outgoingCalls: unknown;
    try {
      const result = await query("outgoingCalls", 2);
      assert.match(JSON.stringify(result), /probe_leaf/);
      assert.equal(
        z
          .array(z.object({ fromRanges: z.array(z.unknown()) }))
          .parse(result)[0]!.fromRanges.length,
        2,
      );
      outgoingCalls = { supported: true, result };
    } catch (error) {
      // OHOS clangd 15 advertises callHierarchyProvider but implements only
      // incomingCalls. Keep the concrete method rejection visible in evidence.
      if (errorResult(error).code !== "LSP_CAPABILITY_UNAVAILABLE") throw error;
      outgoingCalls = { supported: false, reason: errorResult(error) };
    }
    return {
      documentSymbol,
      workspaceSymbol,
      prepareCallHierarchy,
      incomingCalls,
      outgoingCalls,
    };
  } finally {
    fs.writeFileSync(absolute, original);
  }
}
