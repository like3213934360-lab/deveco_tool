#!/usr/bin/env node
import fs from "node:fs";
import { z } from "zod";
import { errorResult, invariant } from "./core/errors.js";
import { atomicWrite } from "./core/files.js";

async function main() {
  const command = process.argv[2] ?? "mcp";
  if (command === "internal-check") {
    const inputFile = process.argv[3],
      outputFile = process.argv[4];
    invariant(
      inputFile && outputFile,
      "CHECK_INPUT_REQUIRED",
      "Checker input/output paths required",
    );
    const input = z
      .strictObject({
        project_path: z.string(),
        product: z.string().optional(),
        files: z.array(z.string()).optional(),
      })
      .parse(JSON.parse(fs.readFileSync(inputFile, "utf8")) as unknown);
    const { staticCheck } = await import("./services/checker.js");
    atomicWrite(outputFile, JSON.stringify(await staticCheck(input)));
    return;
  }
  if (command === "mcp") {
    const { serve } = await import("./server.js");
    await serve();
    return;
  }
  if (command === "doctor") {
    const { WorkerClient } = await import("./core/worker-client.js");
    const runtime = new WorkerClient((error) => {
      process.stderr.write(error.message + "\n");
      process.exit(1);
    });
    try {
      process.stdout.write(
        JSON.stringify(await runtime.call("deveco_doctor", {}), null, 2) + "\n",
      );
    } finally {
      await runtime.close();
    }
    return;
  }
  throw new Error("Usage: deveco-tool [mcp|doctor]");
}
main().catch((error) => {
  process.stderr.write(JSON.stringify(errorResult(error)) + "\n");
  process.exitCode = 1;
});
