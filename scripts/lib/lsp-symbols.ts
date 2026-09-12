import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { z } from "zod";
import type { Runtime } from "../../src/services/runtime.js";
import { errorResult } from "../../src/core/errors.js";
import { symbolResults } from "../../src/services/language-symbols.js";

const positionAt = (source: string, offset: number) => {
  const lines = source.slice(0, offset).split(/\r\n|\r|\n/);
  return { line: lines.length - 1, character: lines.at(-1)!.length };
};
const occurrence = (source: string, text: string) => {
  const offset = source.indexOf(text);
  assert.ok(offset >= 0, text);
  return positionAt(source, offset);
};
const leafRanges = (source: string) =>
  [...source.matchAll(/probeLeaf\([12]\)/g)].map((match) => ({
    start: positionAt(source, match.index),
    end: positionAt(source, match.index + "probeLeaf".length),
  }));

/** Required ArkTS positive acceptance: local rejection or an SDK error fails. */
export async function acceptLanguageSymbols(
  runtime: Pick<Runtime, "call">,
  project_path: string,
) {
  const provider = "entry/src/main/ets/SymbolProbe.ets";
  const consumer = "entry/src/main/ets/CallProbe.ets";
  const providerSource =
    "export function probeLeaf(value: number): number { return value + 1; }\n" +
    "export interface ProbeContract { compute(value: number): number; }\n" +
    "export class SymbolProbe implements ProbeContract {\n" +
    "  compute(value: number): number { return probeLeaf(value); }\n" +
    "  relay(value: number): number { return this.compute(value) + this.compute(value + 1); }\n}\n" +
    "export function localCaller(): number { return probeLeaf(1) + probeLeaf(2); }\n";
  const additionalCallers =
    "export function methodCaller(): number {\n" +
    "  const instance: SymbolProbe = new SymbolProbe();\n" +
    "  return instance.compute(1) + instance.compute(2);\n}\n" +
    "export function nestedCaller(): number {\n" +
    "  const nested: () => number = (): number => { return probeLeaf(3) + probeLeaf(4); };\n" +
    "  return nested();\n}\n";
  const variants = [
    {
      name: "lf-inline",
      source:
        "import { probeLeaf, SymbolProbe } from './SymbolProbe';\n" +
        "export function probeCaller(): number { return probeLeaf(1) + probeLeaf(2); }\n" +
        "export function emptyCaller(): number { return 0; }\n" +
        additionalCallers,
    },
    {
      name: "crlf-utf16-multiline",
      source:
        "import { probeLeaf, SymbolProbe } from './SymbolProbe';\r\n" +
        "// 中文与非 BMP 字符 😀\r\n" +
        "export function probeCaller(): number {\r\n" +
        "  const text: string = '😀'; return text.length + probeLeaf(1) +\r\n" +
        "    probeLeaf(2);\r\n}\r\n" +
        "export function emptyCaller(): number { return 0; }\r\n" +
        additionalCallers.replaceAll("\n", "\r\n"),
    },
  ];
  const owned: string[] = [];
  const observations: Record<string, unknown> = {};
  await runtime.call("harmony_knowledge", {
    action: "read",
    kind: "rules",
    id: "arkts-grammar-standards/recipes-core",
  });
  try {
    for (const [file, source] of [
      [provider, providerSource],
      [consumer, variants[0]!.source],
    ] as const) {
      const absolute = path.join(project_path, file);
      fs.writeFileSync(absolute, source, { flag: "wx", mode: 0o600 });
      owned.push(absolute);
    }
    for (const [index, variant] of variants.entries()) {
      if (index)
        fs.writeFileSync(path.join(project_path, consumer), variant.source);
      const check = await runtime.call("arkts_check", {
        project_path,
        files: [provider, consumer],
      });
      assert.equal(
        z.object({ summary: z.object({ errorCount: z.number() }) }).parse(check)
          .summary.errorCount,
        0,
      );
      const operations: Record<string, unknown> = {};
      const query = async (
        action: keyof typeof symbolResults,
        selectedFile = provider,
        position = occurrence(providerSource, "probeLeaf"),
      ) => {
        const result = await runtime.call("lsp", {
          action,
          project_path,
          file: selectedFile,
          ...position,
          ...(action === "workspaceSymbol" ? { query: "SymbolProbe" } : {}),
        });
        symbolResults[action].parse(result);
        operations[action] = {
          language: "arkts",
          outcome: "executed",
          supported: true,
          result,
        };
        return result;
      };
      await query("documentSymbol", consumer);
      const document = await query("documentSymbol");
      assert.match(JSON.stringify(document), /probeLeaf|SymbolProbe/);
      const workspace = await query("workspaceSymbol");
      assert.match(JSON.stringify(workspace), /SymbolProbe/);
      const prepared = symbolResults.prepareCallHierarchy.parse(
        await query("prepareCallHierarchy"),
      );
      assert.equal(prepared?.[0]?.name, "probeLeaf");
      assert.equal(
        prepared?.[0]?.uri,
        pathToFileURL(path.join(project_path, provider)).href,
      );
      const incoming = symbolResults.incomingCalls.parse(
        await query("incomingCalls"),
      );
      const from = incoming?.find((value) => value.from.name === "probeCaller");
      assert.ok(from);
      assert.equal(
        from.from.uri,
        pathToFileURL(path.join(project_path, consumer)).href,
      );
      const expected = leafRanges(variant.source);
      assert.equal(expected.length, 2);
      assert.deepEqual(from.fromRanges, expected);
      const outgoing = symbolResults.outgoingCalls.parse(
        await query(
          "outgoingCalls",
          consumer,
          occurrence(variant.source, "probeCaller"),
        ),
      );
      assert.equal(outgoing?.length, 1);
      assert.equal(outgoing[0]!.to.name, "probeLeaf");
      assert.equal(
        outgoing[0]!.to.uri,
        pathToFileURL(path.join(project_path, provider)).href,
      );
      assert.deepEqual(outgoing[0]!.fromRanges, expected);
      const extended: Record<string, unknown> = {};
      for (const item of [
        {
          name: "same-file-function",
          file: provider,
          source: providerSource,
          caller: "localCaller",
          callee: "probeLeaf",
          calls: /probeLeaf(?=\([12]\))/g,
          destination: provider,
        },
        {
          name: "same-file-class-method",
          file: provider,
          source: providerSource,
          caller: "relay",
          callee: "compute",
          calls: /compute(?=\(value(?: \+ 1)?\))/g,
          destination: provider,
        },
        {
          name: "cross-file-class-method",
          file: consumer,
          source: variant.source,
          caller: "methodCaller",
          callee: "compute",
          calls: /compute(?=\([12]\))/g,
          destination: provider,
        },
        {
          name: "nested-arrow",
          file: consumer,
          source: variant.source,
          caller: "nested:",
          callee: "probeLeaf",
          calls: /probeLeaf(?=\([34]\))/g,
          destination: provider,
        },
      ]) {
        const callerPosition = occurrence(item.source, item.caller);
        const declaration = symbolResults.prepareCallHierarchy.parse(
          await runtime.call("lsp", {
            action: "prepareCallHierarchy",
            project_path,
            file: item.file,
            ...callerPosition,
          }),
        );
        assert.equal(declaration?.length, 1, item.name);
        const relation = symbolResults.outgoingCalls.parse(
          await runtime.call("lsp", {
            action: "outgoingCalls",
            project_path,
            file: item.file,
            ...callerPosition,
          }),
        );
        const matching = relation?.filter(
          (value) => value.to.name === item.callee,
        );
        assert.equal(matching?.length, 1, `${item.name}: callee relation`);
        const call = matching![0]!;
        assert.equal(
          call.to.uri,
          pathToFileURL(path.join(project_path, item.destination)).href,
          item.name,
        );
        const expectedRanges = [...item.source.matchAll(item.calls)]
          .filter((match) => match.index >= item.source.indexOf(item.caller))
          .map((match) => ({
            start: positionAt(item.source, match.index),
            end: positionAt(item.source, match.index + match[0].length),
          }));
        assert.equal(expectedRanges.length, 2, item.name);
        assert.deepEqual(
          call.fromRanges,
          expectedRanges,
          `${item.name}: exact caller coordinates`,
        );
        const reverse = symbolResults.incomingCalls.parse(
          await runtime.call("lsp", {
            action: "incomingCalls",
            project_path,
            file: item.destination,
            ...call.to.selectionRange.start,
          }),
        );
        const selected = reverse?.find(
          (value) =>
            value.from.uri === declaration![0]!.uri &&
            JSON.stringify(value.from.selectionRange) ===
              JSON.stringify(declaration![0]!.selectionRange),
        );
        assert.ok(selected, `${item.name}: reverse semantic relation`);
        assert.deepEqual(selected.fromRanges, expectedRanges, item.name);
        extended[item.name] = {
          declaration,
          outgoing: relation,
          incoming: selected,
          expected_call_ranges: expectedRanges,
        };
      }
      const legacy: Record<string, unknown> = {};
      const leafCall = positionAt(
        variant.source,
        variant.source.indexOf("probeLeaf(1)"),
      );
      for (const action of ["definition", "references", "hover"] as const) {
        const result = await runtime.call("lsp", {
          action,
          project_path,
          file: consumer,
          ...leafCall,
        });
        legacy[action] = result;
        assert.ok(
          result !== null &&
            (Array.isArray(result)
              ? result.length > 0
              : Object.keys(result as object).length > 0),
          `${action}: non-empty result`,
        );
        if (action === "hover")
          assert.match(JSON.stringify(result), /probeLeaf|number/);
        else assert.match(JSON.stringify(result), /SymbolProbe|CallProbe/);
      }
      const implementation = await runtime.call("lsp", {
        action: "implementation",
        project_path,
        file: provider,
        ...occurrence(providerSource, "ProbeContract"),
      });
      assert.ok(
        Array.isArray(implementation) && implementation.length > 0,
        "interface implementation",
      );
      legacy.implementation = implementation;
      legacy.diagnostics = await runtime.call("lsp", {
        action: "diagnostics",
        project_path,
        file: consumer,
      });
      assert.equal(
        z
          .object({
            diagnostics: z.array(z.object({ severity: z.number().optional() })),
          })
          .parse(legacy.diagnostics)
          .diagnostics.filter((item) => item.severity === 1).length,
        0,
      );
      const brokenSource =
        variant.source + 'export const probeMismatch: number = "wrong type";\n';
      fs.writeFileSync(path.join(project_path, consumer), brokenSource);
      legacy.broken_diagnostics = await runtime.call("lsp", {
        action: "diagnostics",
        project_path,
        file: consumer,
      });
      const broken = z
        .object({
          diagnostic_transport: z.literal("pull"),
          diagnostics: z.array(
            z.object({
              severity: z.number().optional(),
              code: z.union([z.string(), z.number()]).optional(),
              range: z.object({
                start: z.object({ line: z.number(), character: z.number() }),
                end: z.object({ line: z.number(), character: z.number() }),
              }),
            }),
          ),
        })
        .parse(legacy.broken_diagnostics);
      const mismatch = broken.diagnostics.find(
        (item) => item.code === 2322 && item.severity === 1,
      );
      assert.ok(
        mismatch,
        "Pull diagnostics must find the deliberately introduced type mismatch",
      );
      const mismatchOffset = brokenSource.indexOf("probeMismatch");
      assert.deepEqual(mismatch.range, {
        start: positionAt(brokenSource, mismatchOffset),
        end: positionAt(brokenSource, mismatchOffset + "probeMismatch".length),
      });
      fs.writeFileSync(path.join(project_path, consumer), variant.source);
      legacy.repaired_diagnostics = await runtime.call("lsp", {
        action: "diagnostics",
        project_path,
        file: consumer,
      });
      assert.equal(
        z
          .object({
            diagnostics: z.array(z.object({ severity: z.number().optional() })),
          })
          .parse(legacy.repaired_diagnostics)
          .diagnostics.filter((item) => item.severity === 1).length,
        0,
      );
      const empty = await runtime.call("lsp", {
        action: "outgoingCalls",
        project_path,
        file: consumer,
        ...occurrence(variant.source, "emptyCaller"),
      });
      assert.deepEqual(empty, []);
      const missing = await runtime.call("lsp", {
        action: "workspaceSymbol",
        project_path,
        file: provider,
        query: "MissingSymbolProbe_d67e562d",
      });
      assert.ok(
        missing === null || (Array.isArray(missing) && missing.length === 0),
      );
      observations[variant.name] = {
        check,
        operations,
        source: { provider: providerSource, consumer: variant.source },
        expected_call_ranges: expected,
        extended,
        legacy,
        empty,
        missing,
      };
    }
    return { language: "arkts", variants: observations };
  } finally {
    for (const file of owned) fs.rmSync(file);
  }
}

/** Real SDK clangd path. Run only in the isolated CMake acceptance project. */
export async function acceptCppSymbols(
  runtime: Pick<Runtime, "call">,
  project_path: string,
) {
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
      const reason = errorResult(error);
      if (
        reason.code !== "LSP_CAPABILITY_UNAVAILABLE" ||
        !z
          .object({
            method: z.literal("callHierarchy/outgoingCalls"),
            rpc_code: z.literal(-32601),
            source: z.literal("jsonrpc_response"),
            request_dispatched: z.literal(true),
          })
          .safeParse(reason.details).success
      )
        throw error;
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
