import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { BoundedSqliteSaver } from "../src/core/checkpointer.js";
import { atomicWrite } from "../src/core/files.js";
import { evidenceIdentity } from "./lib/evidence.js";

const output = path.resolve(z.string().min(1).parse(process.argv[2])), tested = evidenceIdentity();
assert.equal(fs.existsSync(output), false, "Use a new orchestration evidence file");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-orchestration-")), store = new StateStore(directory), saver = new BoundedSqliteSaver(store);
const state = Annotation.Root({ value: Annotation<number>() });
const builder = new StateGraph(state).addNode("read", (input) => ({ value: input.value + 1 })).addEdge(START, "read").addEdge("read", END);
const graph = builder.compile(), persistent = builder.compile({ checkpointer: saver });
const orchestration_ms: number[] = [], checkpoint_ms: number[] = [], persistent_graph_ms: number[] = [];
try {
  for (let index = 0; index < 1000; index++) {
    let started = performance.now();
    assert.equal((await graph.invoke({ value: index })).value, index + 1);
    orchestration_ms.push(performance.now() - started);
    const checkpoint = emptyCheckpoint(), config = { configurable: { thread_id: `checkpoint-${index}`, checkpoint_ns: "" } };
    checkpoint.channel_values = { run_id: `checkpoint-${index}`, outputs: { sample: index } };
    started = performance.now();
    const saved = await saver.put(config, checkpoint, { source: "input", step: 0, parents: {} });
    await saver.putWrites(saved, [["result", { sample: index }]], "read");
    const restored = await saver.getTuple(saved);
    assert.equal(restored?.checkpoint.channel_values.outputs && (restored.checkpoint.channel_values.outputs as { sample: number }).sample, index);
    checkpoint_ms.push(performance.now() - started);
    started = performance.now();
    assert.equal((await persistent.invoke({ value: index }, { configurable: { thread_id: `graph-${index}` } })).value, index + 1);
    persistent_graph_ms.push(performance.now() - started);
  }
  assert.equal(evidenceIdentity().compiled_sha256, tested.compiled_sha256);
  atomicWrite(output, JSON.stringify({ tested, passed: true, scope: "One-node official LangGraph without persistence, bounded SQLite checkpoint put/pending-write/read round trip, and the same graph with production checkpointer. No SDK or simulated workflow latency is included.", orchestration_ms, checkpoint_ms, persistent_graph_ms }, null, 2) + "\n", false);
} finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
