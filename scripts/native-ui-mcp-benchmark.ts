import { finishAcceptance } from "./lib/acceptance-report.js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { evidenceIdentity } from "./lib/evidence.js";

const baseline = path.resolve(z.string().min(1).parse(process.argv[2])),
  output = path.resolve(z.string().min(1).parse(process.argv[3])),
  rounds = z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .parse(process.argv[4] ?? 3),
  tested = evidenceIdentity();
assert.ok(!fs.existsSync(output), "Use a new evidence directory");
const baselineCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: baseline,
  encoding: "utf8",
}).trim();
assert.equal(baselineCommit, "aab1405b51e00e4036bdc8f18ae4229835de77b0");
assert.equal(
  execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: baseline,
    encoding: "utf8",
  }).trim(),
  "",
  "Frozen baseline tracked files must be unchanged",
);
fs.mkdirSync(output, { recursive: true });
const fixtures = [100, 1000, 10000].map((count) => {
  const file = path.join(output, `tree-${count}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      attributes: {
        type: "WindowScene",
        id: "window",
        bounds: "[0,0][1080,2400]",
      },
      children: Array.from({ length: count }, (_, index) => ({
        attributes: {
          id: `key-${index}`,
          type: index % 3 === 0 ? "Button" : "Text",
          text: `label-${index}`,
          bounds: "[10,10][50,50]",
          visible: true,
          enabled: index % 2 === 0,
        },
      })),
    }),
    { flag: "wx" },
  );
  return {
    file,
    nodes: count + 1,
    bytes: fs.statSync(file).size,
    sha256: fileDigest(file),
    key: `key-${count - 1}`,
  };
});
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !entry[0].startsWith("DEVECO_") &&
      !["NODE_PATH", "NODE_OPTIONS"].includes(entry[0]),
  ),
);
type Record = {
  round: number;
  version: "baseline" | "native";
  nodes: number;
  input_bytes: number;
  first_query_ms: number;
  samples_ms: number[];
  response_bytes: number;
};
const records: Record[] = [];
function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50_ms: sorted[Math.floor(sorted.length * 0.5)]!,
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    max_ms: sorted.at(-1)!,
  };
}
let completed = false,
  error: string | null = null;
function save() {
  const comparisons = fixtures.flatMap(({ nodes }) => {
    const pairs = Array.from({ length: rounds }, (_, i) => {
      const old = records.find(
          (r) =>
            r.round === i + 1 && r.nodes === nodes && r.version === "baseline",
        ),
        current = records.find(
          (r) =>
            r.round === i + 1 && r.nodes === nodes && r.version === "native",
        );
      if (
        old?.samples_ms.length !== 1000 ||
        current?.samples_ms.length !== 1000
      )
        return [];
      return [
        {
          round: i + 1,
          baseline: summarize(old.samples_ms),
          native: summarize(current.samples_ms),
          p95_change_percent:
            (summarize(current.samples_ms).p95_ms /
              summarize(old.samples_ms).p95_ms -
              1) *
            100,
        },
      ];
    }).flat();
    return {
      nodes,
      pairs,
      within_five_percent_every_round:
        pairs.length === rounds &&
        pairs.every((p) => p.p95_change_percent <= 5),
    };
  });
  atomicWrite(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        tested,
        baseline: {
          directory: baseline,
          commit: baselineCommit,
          lock_sha256: fileDigest(path.join(baseline, "package-lock.json")),
        },
        scope:
          "Full stdio MCP ui_find round trips against identical immutable saved UiTest files, including default logging, file reads, parsing/signatures, selector query, worker IPC and response serialization. One unique exact-key match checked after every call; version-specific output schemas differ. No SDK/device access. Twenty warmups and 1000 timed calls per size/server; fresh servers each round, alternating version order. First query includes lazy runtime startup and is reported separately. This tests only offline ui_find, not all direct capabilities. Driver resources and on-disk sizes are not server/SDK CPU, RSS or write counters.",
        rounds,
        warmups: 20,
        samples: 1000,
        fixtures,
        records,
        comparisons,
        completed,
        error,
      },
      null,
      2,
    ),
  );
  return comparisons.every((item) => item.within_five_percent_every_round);
}
try {
  for (let round = 1; round <= rounds; round++) {
    const versions =
      round % 2
        ? (["baseline", "native"] as const)
        : (["native", "baseline"] as const);
    for (const version of versions) {
      const directory = path.join(output, `${round}-${version}`);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "config.json"), "{}\n");
      const client = new Client({
          name: "native-ui-mcp-benchmark",
          version: "1",
        }),
        transport = new StdioClientTransport({
          command: process.execPath,
          args: [
            version === "baseline"
              ? path.join(baseline, "src/server.mjs")
              : fileURLToPath(new URL("../src/cli.js", import.meta.url)),
          ],
          cwd: directory,
          stderr: "pipe",
          env: {
            ...environment,
            DEVECO_STATE_DIR: path.join(directory, "state"),
            DEVECO_CONFIG: path.join(directory, "config.json"),
            DEVECO_TOOL_LOG_DIR: path.join(directory, "baseline-logs"),
            DEVECO_UI_PERFORMANCE_LOG: "1",
          },
        });
      let stderr = "";
      transport.stderr?.on("data", (data: Buffer) => {
        stderr = (stderr + data.toString("utf8")).slice(-8192);
      });
      try {
        await client.connect(transport);
        for (const fixture of fixtures) {
          const args =
            version === "baseline"
              ? { dumpPath: fixture.file, key: fixture.key, limit: 1 }
              : {
                  tree_file: fixture.file,
                  selector: { key: fixture.key, limit: 1 },
                };
          const call = async () => {
            const start = performance.now();
            const result = await client.callTool({
              name: "ui_find",
              arguments: args,
            });
            const elapsed = performance.now() - start;
            assert.ok(!result.isError, JSON.stringify(result));
            const data: unknown =
              version === "native"
                ? z
                    .object({ ok: z.literal(true), data: z.unknown() })
                    .parse(result.structuredContent).data
                : JSON.parse(
                    z
                      .array(
                        z.object({ type: z.literal("text"), text: z.string() }),
                      )
                      .parse(result.content)[0]!.text,
                  );
            const parsed = z
              .object({
                matchCount: z.number().optional(),
                match_count: z.number().optional(),
                nodeCount: z.number().optional(),
                node_count: z.number().optional(),
                matches: z.array(z.object({ key: z.string() })),
              })
              .parse(data);
            assert.equal(parsed.matchCount ?? parsed.match_count, 1);
            assert.equal(parsed.nodeCount ?? parsed.node_count, fixture.nodes);
            assert.deepEqual(
              parsed.matches.map((m) => m.key),
              [fixture.key],
            );
            return {
              elapsed,
              bytes: Buffer.byteLength(JSON.stringify(result)),
            };
          };
          const first = await call();
          for (let warm = 0; warm < 20; warm++) await call();
          const record: Record = {
            round,
            version,
            nodes: fixture.nodes,
            input_bytes: fixture.bytes,
            first_query_ms: first.elapsed,
            samples_ms: [],
            response_bytes: first.bytes,
          };
          records.push(record);
          for (let sample = 0; sample < 1000; sample++)
            record.samples_ms.push((await call()).elapsed);
          save();
          process.stdout.write(
            `${round}/${rounds} ${version} ${fixture.nodes} nodes: ${JSON.stringify(summarize(record.samples_ms))}\n`,
          );
        }
      } finally {
        await transport.close();
        fs.writeFileSync(path.join(directory, "stderr.txt"), stderr, {
          flag: "wx",
        });
      }
    }
  }
  const after = evidenceIdentity();
  for (const key of [
    "runtime_sha256",
    "compiled_sha256",
    "package_lock_sha256",
    "resource_manifest_sha256",
  ] as const)
    assert.equal(
      after[key],
      tested[key],
      `Tested ${key} changed while measuring`,
    );
  for (const fixture of fixtures)
    assert.equal(fileDigest(fixture.file), fixture.sha256);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: baseline,
      encoding: "utf8",
    }).trim(),
    baselineCommit,
  );
  assert.equal(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: baseline,
      encoding: "utf8",
    }).trim(),
    "",
  );
  completed = true;
} catch (cause) {
  error =
    cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
  throw cause;
} finally {
  const withinLimits = save();
  finishAcceptance(path.join(output, "evidence.json"), tested, completed && withinLimits && error === null, completed);
}
