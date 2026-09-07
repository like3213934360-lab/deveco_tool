import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import { digest } from "../src/core/files.js";
import { invariant } from "../src/core/errors.js";
import { candidateSchema, lockSchema, mappingSchema } from "./lib/upstream.js";

const lock = lockSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "provenance/upstream-lock.json"),
        "utf8",
      ),
    ) as unknown,
  ),
  mapping = mappingSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "provenance/upstream-mapping.json"),
        "utf8",
      ),
    ) as unknown,
  ),
  directory = path.join(packageRoot, "provenance/upstream-candidates");
let count = 0;
for (const item of fs.existsSync(directory)
  ? fs.readdirSync(directory, { withFileTypes: true })
  : []) {
  invariant(
    item.isDirectory(),
    "UPSTREAM_CANDIDATE_INVALID",
    "Candidate root accepts source directories only",
  );
  const file = path.join(directory, item.name, "candidate.json");
  invariant(
    fs.statSync(file).size <= 1024 * 1024,
    "UPSTREAM_REPORT_TOO_LARGE",
    "Candidate report limit is 1 MiB",
  );
  const report = candidateSchema.parse(
      JSON.parse(fs.readFileSync(file, "utf8")) as unknown,
    ),
    { sha256, ...payload } = report;
  invariant(
    digest(payload) === sha256 && report.mapping_sha256 === digest(mapping),
    "UPSTREAM_REPORT_STALE",
    "Regenerate changed or stale candidate reports",
  );
  const source = lock.sources.find((entry) => entry.id === report.source);
  invariant(
    source && source.id === item.name && source.url === report.url,
    "UPSTREAM_SOURCE_INVALID",
    "Candidate source is not in the lock",
  );
  invariant(
    !report.changes.some((entry) => entry.disposition === "unmapped"),
    "UPSTREAM_UNMAPPED",
    "Unmapped upstream paths block candidate acceptance",
  );
  invariant(
    source.acceptance === "verified" &&
      source.commit === report.candidate.commit &&
      source.tree === report.candidate.tree,
    "UPSTREAM_REVIEW_REQUIRED",
    "Candidate is a proposal: adapt, validate and review it before updating the source lock",
  );
  count++;
}
console.log(
  JSON.stringify({
    candidate_reports: count,
    candidate_gate: "passed",
    release_ready: false,
    note: "This gate checks reviewed source references. SDK, device, migration and performance release gates remain separate.",
  }),
);
