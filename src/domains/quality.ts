import fs from "node:fs";
import path from "node:path";
import { invariant } from "../core/errors.js";
import { atomicWrite, sha256 } from "../core/files.js";
import type { Verdict } from "./evidence.js";

export interface Metric { value: number; direction: "lower" | "higher" }
export interface Measurement { metrics: Record<string, Metric>; diagnostics?: string[] }

/** Stable diagnostic identities exclude line movement but preserve code, file and message. */
export function diagnosticKeys(issues: { file?: string; code?: string | number; message: string; severity?: string }[]) {
  return [...new Set(issues.map((i) => JSON.stringify([i.file?.replaceAll("\\", "/"), i.code, i.severity, i.message.replace(/\s+/g, " ")])))] .sort();
}

/** Match environment and measurement method exactly before comparing values. */
export function compareMeasurement(previous: Measurement, current: Measurement, tolerancePercent: number) {
  const regression: { metric: string; before: number; after: number; allowed_percent: number }[] = [];
  invariant(Object.keys(previous.metrics).sort().join() === Object.keys(current.metrics).sort().join(), "BASELINE_INCOMPATIBLE", "Measured metrics differ from baseline");
  for (const [name, metric] of Object.entries(current.metrics)) {
    const old = previous.metrics[name]!;
    invariant(Number.isFinite(metric.value) && Number.isFinite(old.value) && metric.direction === old.direction, "BASELINE_INCOMPATIBLE", "Invalid metric or comparison direction");
    const delta = metric.direction === "lower" ? metric.value - old.value : old.value - metric.value;
    if (delta > Math.abs(old.value) * tolerancePercent / 100) regression.push({ metric: name, before: old.value, after: metric.value, allowed_percent: tolerancePercent });
  }
  const added = (current.diagnostics ?? []).filter((i) => !previous.diagnostics?.includes(i));
  const removed = (previous.diagnostics ?? []).filter((i) => !current.diagnostics?.includes(i));
  return { verdict: regression.length || added.length ? "failed" as const : "passed" as const, regression, diagnostics: { added, removed } };
}

/** Recording is explicit and never reported as a passing comparison. */
export function qualityBaseline(project: string, name: string, context: unknown, measurement: Measurement, mode: "compare" | "record", tolerancePercent = 0) {
  invariant(/^[\w.-]{1,80}$/.test(name), "INVALID_INPUT", "Invalid quality baseline name");
  invariant(Object.keys(measurement.metrics).length || measurement.diagnostics, "EVIDENCE_MISSING", "No measured data to baseline");
  const file = path.join(project, ".arkpilot", "quality-baselines", `${name}.json`), identity = sha256(JSON.stringify(context));
  if (mode === "record") {
    atomicWrite(file, JSON.stringify({ schema: 1, identity, context, measurement, recorded_at: new Date().toISOString() }, null, 2));
    return { verdict: "recorded" as Verdict, file, identity };
  }
  invariant(fs.existsSync(file), "BASELINE_MISSING", `Missing baseline ${name}`, { file }, "Review a dedicated baseline recording run before comparing");
  const previous = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(previous.schema === 1 && previous.identity === identity, "BASELINE_INCOMPATIBLE", "Baseline environment or measurement method changed", { file, expected: previous.context, actual: context });
  return { ...compareMeasurement(previous.measurement, measurement, tolerancePercent), file, identity, baseline_sha256: sha256(fs.readFileSync(file)), baseline_snapshot: previous };
}
